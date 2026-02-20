/**
 * Competitor analysis using Haversine formula (no PostGIS dependency).
 * Finds hospitals within a given radius of a target hospital.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompetitorData } from '@madmedsales/shared';

const EARTH_RADIUS_KM = 6371;
const CURRENT_YEAR_THRESHOLD = 3; // "modern RF" = within 3 years

/**
 * Haversine distance between two coordinates in meters.
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c * 1000; // Convert to meters
}

interface HospitalLocation {
  id: string;
  latitude: number | null;
  longitude: number | null;
}

interface NearbyHospital {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  sigungu: string | null;
}

interface NearbyEquipment {
  hospital_id: string;
  equipment_category: string;
  equipment_name: string;
  estimated_year: number | null;
}

interface NearbyTreatmentCount {
  hospital_id: string;
}

/**
 * Get competitor hospitals within a given radius.
 * Uses Haversine formula for distance calculation.
 */
export async function getCompetitors(
  supabase: SupabaseClient,
  hospital: HospitalLocation,
  radiusKm: number = 1
): Promise<CompetitorData[]> {
  if (hospital.latitude === null || hospital.longitude === null) {
    return [];
  }

  const { latitude, longitude } = hospital;

  // Get hospitals in the same sigungu area
  // First, get the sigungu of the target hospital
  const { data: targetHospital } = await supabase
    .from('hospitals')
    .select('sigungu')
    .eq('id', hospital.id)
    .single();

  if (!targetHospital?.sigungu) {
    return [];
  }

  // Get all active hospitals in the same sigungu
  const { data: candidates, error } = await supabase
    .from('hospitals')
    .select('id, name, latitude, longitude, sigungu')
    .eq('status', 'active')
    .eq('sigungu', targetHospital.sigungu)
    .neq('id', hospital.id)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);

  if (error || !candidates) {
    return [];
  }

  // Filter by Haversine distance
  const radiusMeters = radiusKm * 1000;
  const nearbyHospitals: { hospital: NearbyHospital; distance: number }[] = [];

  for (const candidate of candidates as NearbyHospital[]) {
    const distance = haversineDistance(
      latitude,
      longitude,
      candidate.latitude,
      candidate.longitude
    );

    if (distance <= radiusMeters) {
      nearbyHospitals.push({ hospital: candidate, distance });
    }
  }

  if (nearbyHospitals.length === 0) {
    return [];
  }

  // Get equipment data for nearby hospitals
  const nearbyIds = nearbyHospitals.map((n) => n.hospital.id);

  const { data: equipments } = await supabase
    .from('hospital_equipments')
    .select('hospital_id, equipment_category, equipment_name, estimated_year')
    .in('hospital_id', nearbyIds)
    .eq('equipment_category', 'rf');

  // Get treatment counts
  const { data: treatmentRows } = await supabase
    .from('hospital_treatments')
    .select('hospital_id')
    .in('hospital_id', nearbyIds);

  const currentYear = new Date().getFullYear();
  const equipmentMap = new Map<string, NearbyEquipment[]>();
  for (const eq of (equipments ?? []) as NearbyEquipment[]) {
    const existing = equipmentMap.get(eq.hospital_id) ?? [];
    existing.push(eq);
    equipmentMap.set(eq.hospital_id, existing);
  }

  const treatmentCountMap = new Map<string, number>();
  for (const t of (treatmentRows ?? []) as NearbyTreatmentCount[]) {
    treatmentCountMap.set(
      t.hospital_id,
      (treatmentCountMap.get(t.hospital_id) ?? 0) + 1
    );
  }

  // Build competitor data
  const competitors: CompetitorData[] = nearbyHospitals.map((n) => {
    const rfEquipments = equipmentMap.get(n.hospital.id) ?? [];
    const hasModernRF = rfEquipments.some(
      (e) =>
        e.estimated_year !== null &&
        currentYear - e.estimated_year <= CURRENT_YEAR_THRESHOLD
    );

    const modernRfEquipment = rfEquipments.find(
      (e) =>
        e.estimated_year !== null &&
        currentYear - e.estimated_year <= CURRENT_YEAR_THRESHOLD
    );

    return {
      hospital_id: n.hospital.id,
      name: n.hospital.name,
      distance_meters: Math.round(n.distance),
      hasModernRF,
      rfEquipmentName: modernRfEquipment?.equipment_name ?? null,
      treatmentCount: treatmentCountMap.get(n.hospital.id) ?? 0,
    };
  });

  // Sort by distance
  competitors.sort((a, b) => a.distance_meters - b.distance_meters);

  return competitors;
}
