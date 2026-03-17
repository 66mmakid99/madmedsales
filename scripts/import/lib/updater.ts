import { SupabaseClient } from '@supabase/supabase-js';
import { MatchResult, UpdateAction, MatchOptions } from './types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('updater');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface UpdateRecord {
  hospitalId: string;
  email: string;
  previousEmail: string;
}

export function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

export function decideAction(result: MatchResult, options: MatchOptions): UpdateAction {
  if (!result.matched) return 'no_match';
  if (!validateEmail(result.excelRow.email)) return 'skipped_invalid_email';
  if (result.matched.email && !options.overwrite) return 'skipped_existing';
  return 'updated';
}

export async function batchUpdate(
  supabase: SupabaseClient,
  records: UpdateRecord[],
  options: MatchOptions,
): Promise<{ success: number; failed: number }> {
  if (options.dryRun) {
    log.info(`[DRY-RUN] Would update ${records.length} hospitals`);
    return { success: records.length, failed: 0 };
  }

  let success = 0, failed = 0;

  for (let i = 0; i < records.length; i += options.batchSize) {
    const batch = records.slice(i, i + options.batchSize);

    for (const record of batch) {
      const { error } = await supabase
        .from('hospitals')
        .update({ email: record.email, updated_at: new Date().toISOString() })
        .eq('id', record.hospitalId);

      if (error) {
        log.error(`Failed to update ${record.hospitalId}: ${error.message}`);
        failed++;
      } else {
        success++;
      }
    }

    log.info(`Batch ${Math.floor(i / options.batchSize) + 1}: ${batch.length}건 처리`);
  }

  return { success, failed };
}
