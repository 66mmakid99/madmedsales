/**
 * Step 5-C: 구매단계 태깅 로직
 * 장비 변동/메일 반응 시그널 → buying_stage 업데이트
 * v4.0 - 2026-03-10
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { T } from '../../lib/table-names';

export type BuyingStage = 'unaware' | 'awareness' | 'consideration' | 'decision';

export interface StageSignal {
  type: string;
  detail: string;
  timestamp: string;
}

interface BuyingStageRow {
  id: string;
  stage: BuyingStage;
  signals: StageSignal[];
}

/**
 * 시그널 기반으로 다음 구매단계 결정
 */
function resolveNextStage(
  currentStage: BuyingStage,
  signalType: string,
): BuyingStage {
  const STAGE_ORDER: BuyingStage[] = ['unaware', 'awareness', 'consideration', 'decision'];
  const currentIdx = STAGE_ORDER.indexOf(currentStage);

  // 시그널별 목표 단계
  const signalStageMap: Record<string, BuyingStage> = {
    // awareness 시그널
    email_opened: 'awareness',
    link_clicked: 'awareness',
    equipment_added: 'awareness',

    // consideration 시그널
    reply_received: 'consideration',
    price_page_visit: 'consideration',
    demo_page_visit: 'consideration',
    equipment_removed: 'consideration',

    // decision 시그널
    demo_scheduled: 'decision',
    demo_completed: 'decision',
    positive_reply: 'decision',
    proposal_requested: 'decision',
  };

  const targetStage = signalStageMap[signalType];
  if (!targetStage) return currentStage;

  const targetIdx = STAGE_ORDER.indexOf(targetStage);

  // 단계는 상승만 허용 (하락하지 않음)
  return targetIdx > currentIdx ? targetStage : currentStage;
}

/**
 * 구매단계 업데이트
 */
export async function updateBuyingStage(
  supabase: SupabaseClient,
  hospitalId: string,
  productId: string,
  signalType: string,
  signalDetail: string,
): Promise<{ stage: BuyingStage; changed: boolean }> {
  // 기존 단계 조회
  const { data: existing } = await supabase
    .from(T.buying_stages)
    .select('id, stage, signals')
    .eq('hospital_id', hospitalId)
    .eq('product_id', productId)
    .single();

  const currentStage: BuyingStage = (existing as BuyingStageRow | null)?.stage ?? 'unaware';
  const currentSignals: StageSignal[] = (existing as BuyingStageRow | null)?.signals ?? [];

  const nextStage = resolveNextStage(currentStage, signalType);
  const changed = nextStage !== currentStage;

  const newSignal: StageSignal = {
    type: signalType,
    detail: signalDetail,
    timestamp: new Date().toISOString(),
  };

  const signals = [...currentSignals, newSignal].slice(-50); // 최근 50개만 유지

  await supabase
    .from(T.buying_stages)
    .upsert(
      {
        hospital_id: hospitalId,
        product_id: productId,
        stage: nextStage,
        signals,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'hospital_id,product_id' },
    );

  // 시나리오의 buying_stage도 동기화
  if (changed) {
    await supabase
      .from(T.scenarios)
      .update({ buying_stage: nextStage })
      .eq('hospital_id', hospitalId)
      .eq('product_id', productId);
  }

  return { stage: nextStage, changed };
}

/**
 * 리드의 engagement 지표로부터 구매단계 자동 갱신
 */
export async function syncBuyingStageFromLead(
  supabase: SupabaseClient,
  leadId: string,
): Promise<void> {
  const { data: lead } = await supabase
    .from(T.leads)
    .select('hospital_id, product_id, open_count, click_count, reply_count, demo_page_visits, price_page_visits')
    .eq('id', leadId)
    .single();

  if (!lead) return;

  const hid = lead.hospital_id as string;
  const pid = lead.product_id as string;

  if ((lead.demo_page_visits as number) >= 2 || (lead.reply_count as number) > 0) {
    await updateBuyingStage(supabase, hid, pid, 'demo_page_visit', `demo_visits=${lead.demo_page_visits}`);
  } else if ((lead.click_count as number) > 0 || (lead.price_page_visits as number) > 0) {
    await updateBuyingStage(supabase, hid, pid, 'link_clicked', `clicks=${lead.click_count}`);
  } else if ((lead.open_count as number) > 0) {
    await updateBuyingStage(supabase, hid, pid, 'email_opened', `opens=${lead.open_count}`);
  }
}
