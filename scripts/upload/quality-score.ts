/**
 * Data quality score calculator
 * Calculates a 0-100 quality score for each hospital based on available data.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('quality-score');

interface HospitalForQuality {
  id: string;
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  latitude: number | null;
  longitude: number | null;
  doctor_name: string | null;
  opened_at: string | null;
  website: string | null;
}

interface UploadError {
  source: string;
  hospitalId: string;
  error: string;
  timestamp: string;
}

export async function updateDataQualityScores(
  supabase: SupabaseClient,
  errors: UploadError[]
): Promise<void> {
  log.info('Calculating data quality scores...');

  const { data: hospitals, error } = await supabase
    .from('hospitals')
    .select('id, name, address, phone, email, latitude, longitude, doctor_name, opened_at, website')
    .eq('status', 'active');

  if (error || !hospitals) {
    log.error('Failed to fetch hospitals for quality scoring', error);
    return;
  }

  for (const hospital of hospitals as HospitalForQuality[]) {
    let score = 0;

    // Basic info
    if (hospital.name) score += 10;
    if (hospital.address) score += 10;
    if (hospital.phone) score += 5;
    if (hospital.email) score += 15;

    // Location
    if (hospital.latitude && hospital.longitude) score += 10;

    // Additional
    if (hospital.doctor_name) score += 5;
    if (hospital.opened_at) score += 5;
    if (hospital.website) score += 5;

    // Equipment check
    const { count: equipCount } = await supabase
      .from('hospital_equipments')
      .select('id', { count: 'exact', head: true })
      .eq('hospital_id', hospital.id);

    if (equipCount && equipCount > 0) score += 15;

    // Treatment check
    const { count: treatCount } = await supabase
      .from('hospital_treatments')
      .select('id', { count: 'exact', head: true })
      .eq('hospital_id', hospital.id);

    if (treatCount && treatCount > 0) score += 10;

    // Treatment price info check
    if (treatCount && treatCount > 0) {
      const { data: priced } = await supabase
        .from('hospital_treatments')
        .select('id')
        .eq('hospital_id', hospital.id)
        .not('price_min', 'is', null)
        .limit(1);

      if (priced && priced.length > 0) score += 5;
    }

    // Naver place check
    const { count: naverCount } = await supabase
      .from('hospital_treatments')
      .select('id', { count: 'exact', head: true })
      .eq('hospital_id', hospital.id)
      .eq('source', 'naver');

    if (naverCount && naverCount > 0) score += 5;

    const finalScore = Math.min(score, 100);

    const { error: updateError } = await supabase
      .from('hospitals')
      .update({ data_quality_score: finalScore })
      .eq('id', hospital.id);

    if (updateError) {
      errors.push({
        source: 'quality-score',
        hospitalId: hospital.id,
        error: updateError.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  log.info('Data quality scores updated');
}
