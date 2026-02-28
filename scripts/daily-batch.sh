#!/bin/bash
# daily-batch.sh — 일일 배치 크롤링 + 검증 파이프라인
#
# Usage:
#   bash scripts/daily-batch.sh                    # 기본 (100개, Phase 2)
#   bash scripts/daily-batch.sh --count 50         # 50개
#   bash scripts/daily-batch.sh --phase 1          # Phase 1 워밍업
#   bash scripts/daily-batch.sh --dry-run          # 미리보기
#   bash scripts/daily-batch.sh --skip-validate    # 검증 스킵
#   bash scripts/daily-batch.sh --count 50 --phase 1  # 조합

set -euo pipefail

# ============================================================
# 설정
# ============================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VALIDATE_DIR="$(dirname "$PROJECT_DIR")/madmedvalidate"

DATE=$(date +%Y%m%d)
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
LOG_DIR="$PROJECT_DIR/output/logs/batch_${DATE}"

# 기본값
BATCH_SIZE=100
PHASE=2
DRY_RUN=false
SKIP_VALIDATE=false

# 인수 파싱
while [[ $# -gt 0 ]]; do
  case $1 in
    --count)    BATCH_SIZE="$2"; shift 2 ;;
    --phase)    PHASE="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=true; shift ;;
    --skip-validate) SKIP_VALIDATE=true; shift ;;
    *)          echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$LOG_DIR"

# ============================================================
# 유틸 함수
# ============================================================
log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
  echo "$msg"
  echo "$msg" >> "$LOG_DIR/batch.log"
}

check_disk() {
  local usage
  usage=$(df -h "$PROJECT_DIR" | awk 'NR==2 {print $5}' | tr -d '%')
  if [[ "$usage" -ge 80 ]]; then
    log "DISK ${usage}% >= 80% — batch stopped"
    exit 1
  fi
  log "  disk: ${usage}%"
}

# ============================================================
# 시작
# ============================================================
log "=== daily-batch: ${DATE} ==="
log "  count: ${BATCH_SIZE} | phase: ${PHASE}"

check_disk

# ============================================================
# 1단계: 대상 병원 선택
# ============================================================
log ""
log "[1/5] batch-selector..."

TARGETS_FILE="$LOG_DIR/targets.json"
cd "$SCRIPT_DIR"

if [[ "$DRY_RUN" == "true" ]]; then
  npx tsx batch-selector.ts \
    --count "$BATCH_SIZE" \
    --phase "$PHASE" \
    --output "$TARGETS_FILE" \
    --dry-run
  log "DRY RUN done"
  exit 0
fi

npx tsx batch-selector.ts \
  --count "$BATCH_SIZE" \
  --phase "$PHASE" \
  --output "$TARGETS_FILE" \
  2>&1 | tee -a "$LOG_DIR/batch.log"

if [[ ! -f "$TARGETS_FILE" ]]; then
  log "targets.json not created — aborting"
  exit 1
fi

TARGET_COUNT=$(node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log(d.count)" "$TARGETS_FILE")
log "  selected: ${TARGET_COUNT} hospitals"

if [[ "$TARGET_COUNT" -eq 0 ]]; then
  log "  no hospitals to crawl — done"
  exit 0
fi

# ============================================================
# 2단계: recrawl-v5.ts --input 으로 일괄 크롤링
# ============================================================
log ""
log "[2/5] recrawl-v5 --input ..."

CRAWL_LOG="$LOG_DIR/crawl.log"
CRAWL_START=$(date +%s)

cd "$SCRIPT_DIR"
set +e
npx tsx recrawl-v5.ts \
  --input "$TARGETS_FILE" \
  --skip-done \
  --ocr \
  2>&1 | tee "$CRAWL_LOG"
CRAWL_EXIT=$?
set -e

CRAWL_END=$(date +%s)
CRAWL_ELAPSED=$(( (CRAWL_END - CRAWL_START) / 60 ))

log "  crawl finished in ${CRAWL_ELAPSED}min (exit: ${CRAWL_EXIT})"

# 크롤링 결과 집계 (summary 로그에서 pass/error 카운트)
PASS_COUNT=$(grep -c '✅' "$CRAWL_LOG" 2>/dev/null || echo 0)
ERROR_COUNT=$(grep -c '❌' "$CRAWL_LOG" 2>/dev/null || echo 0)
SKIP_COUNT=$(grep -c 'skip' "$CRAWL_LOG" 2>/dev/null || echo 0)

log "  results: PASS=${PASS_COUNT} ERROR=${ERROR_COUNT} SKIP=${SKIP_COUNT}"

# ============================================================
# 3단계: 검증 실행
# ============================================================
if [[ "$SKIP_VALIDATE" == "true" ]]; then
  log ""
  log "[3/5] validate skipped (--skip-validate)"
else
  log ""
  log "[3/5] madmedvalidate..."

  VALIDATE_LOG="$LOG_DIR/validate.log"

  cd "$VALIDATE_DIR"
  set +e
  npx tsx src/index.ts \
    --mode full \
    2>&1 | tee "$VALIDATE_LOG"
  set -e
  cd "$SCRIPT_DIR"

  log "  validate done"
fi

# ============================================================
# 4단계: CRM 장비 동기화
# ============================================================
log ""
log "[4/5] sync-detected-equipment..."

SYNC_LOG="$LOG_DIR/sync-equipment.log"

cd "$SCRIPT_DIR"
set +e
npx tsx sync-detected-equipment.ts \
  2>&1 | tee "$SYNC_LOG"
set -e

log "  sync done"

# ============================================================
# 5단계: 일일 요약 생성
# ============================================================
log ""
log "[5/5] daily summary..."

SUMMARY_FILE="$LOG_DIR/daily_summary.json"

node -e "
const fs = require('fs');
const path = require('path');

const targetsFile = process.argv[1];
const validateDir = process.argv[2];
const summaryFile = process.argv[3];
const date = process.argv[4];
const timestamp = process.argv[5];
const phase = parseInt(process.argv[6]);
const crawlMin = parseInt(process.argv[7]);
const crawlExit = parseInt(process.argv[8]);

const targets = JSON.parse(fs.readFileSync(targetsFile, 'utf8'));

let validateSummary = null;
if (fs.existsSync(validateDir)) {
  const files = fs.readdirSync(validateDir)
    .filter(f => f.startsWith('validate_') && !f.includes('detail') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length > 0) {
    validateSummary = JSON.parse(fs.readFileSync(path.join(validateDir, files[0]), 'utf8'));
  }
}

const summary = {
  date,
  timestamp,
  phase,
  batch: {
    requested: targets.count,
    stats: targets.stats,
  },
  crawl: {
    elapsedMinutes: crawlMin,
    exitCode: crawlExit,
  },
  validation: validateSummary ? {
    totalHospitals: validateSummary.totalHospitals,
    gradeDistribution: validateSummary.gradeDistribution,
    abRatio: validateSummary.abRatio,
    systemVerdict: validateSummary.systemVerdict,
  } : null,
};

fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
" "$TARGETS_FILE" "$VALIDATE_DIR/output" "$SUMMARY_FILE" "$DATE" "$TIMESTAMP" "$PHASE" "$CRAWL_ELAPSED" "$CRAWL_EXIT"

log "  saved: $SUMMARY_FILE"

# ============================================================
# 완료
# ============================================================
log ""
log "=== daily-batch: ${DATE} done ==="
log "  logs: $LOG_DIR/"
