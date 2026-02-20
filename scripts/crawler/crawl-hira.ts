/**
 * 심평원 API 크롤러
 * 건강보험심사평가원 의료기관 기본정보 조회 API를 통해
 * 피부과/성형외과 병원 목록을 수집합니다.
 */
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { delay } from '../utils/delay.js';
import { createLogger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const log = createLogger('crawl-hira');

const API_KEY = process.env.DATA_GO_KR_API_KEY;
if (!API_KEY) {
  throw new Error('Missing DATA_GO_KR_API_KEY in scripts/.env');
}

const BASE_URL =
  'http://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList';

const DATA_DIR = path.resolve(__dirname, '../data/hira-raw');

// 진료과목 코드
const DEPARTMENTS = [
  { code: '14', name: '피부과' },
  { code: '09', name: '성형외과' },
] as const;

// 종별 코드: 의원(31), 병원(21)
const CLINIC_TYPES = ['31', '21'] as const;

// 수도권 우선 지역
const PRIORITY_REGIONS = [
  { code: '110000', name: '서울' },
  { code: '410000', name: '경기' },
  { code: '280000', name: '인천' },
] as const;

const DELAY_MS = 500;
const PAGE_SIZE = 100;

interface HiraRawItem {
  ykiho: string;
  yadmNm: string;
  clCd: string;
  clCdNm: string;
  dgsbjtCd: string;
  dgsbjtCdNm: string;
  sidoCd: string;
  sidoCdNm: string;
  sgguCd: string;
  sgguCdNm: string;
  emdongNm: string;
  addr: string;
  telno: string;
  estbDd: string;
  drTotCnt: number;
  cmdcResdntCnt: number;
  XPos: string;
  YPos: string;
}

interface HiraApiResponse {
  response: {
    header: { resultCode: string; resultMsg: string };
    body: {
      items: { item: HiraRawItem | HiraRawItem[] };
      numOfRows: number;
      pageNo: number;
      totalCount: number;
    };
  };
}

async function fetchPage(
  sidoCd: string,
  dgsbjtCd: string,
  clCd: string,
  pageNo: number
): Promise<{ items: HiraRawItem[]; totalCount: number }> {
  const params = {
    serviceKey: API_KEY,
    sidoCd,
    dgsbjtCd,
    clCd,
    numOfRows: String(PAGE_SIZE),
    pageNo: String(pageNo),
    _type: 'json',
  };

  const response = await axios.get<HiraApiResponse>(BASE_URL, { params });
  const body = response.data?.response?.body;

  if (!body) {
    throw new Error(`Unexpected API response structure for page ${pageNo}`);
  }

  const totalCount = body.totalCount ?? 0;
  if (totalCount === 0 || !body.items?.item) {
    return { items: [], totalCount: 0 };
  }

  const rawItems = body.items.item;
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  return { items, totalCount };
}

async function crawlRegionDepartment(
  region: (typeof PRIORITY_REGIONS)[number],
  dept: (typeof DEPARTMENTS)[number]
): Promise<HiraRawItem[]> {
  const allItems: HiraRawItem[] = [];

  for (const clCd of CLINIC_TYPES) {
    let pageNo = 1;
    let totalCount = 0;

    log.info(
      `Fetching ${region.name} / ${dept.name} / 종별=${clCd}, page ${pageNo}`
    );

    const first = await fetchPage(region.code, dept.code, clCd, pageNo);
    totalCount = first.totalCount;
    allItems.push(...first.items);

    log.info(`Total records: ${totalCount}`);

    const totalPages = Math.ceil(totalCount / PAGE_SIZE);

    for (pageNo = 2; pageNo <= totalPages; pageNo++) {
      await delay(DELAY_MS);
      log.info(
        `Fetching ${region.name} / ${dept.name} / 종별=${clCd}, page ${pageNo}/${totalPages}`
      );

      try {
        const page = await fetchPage(region.code, dept.code, clCd, pageNo);
        allItems.push(...page.items);
      } catch (err) {
        log.error(`Failed on page ${pageNo}`, err);
      }
    }

    await delay(DELAY_MS);
  }

  return allItems;
}

async function main(): Promise<void> {
  log.info('Starting HIRA data crawl');

  await fs.mkdir(DATA_DIR, { recursive: true });

  let grandTotal = 0;

  for (const region of PRIORITY_REGIONS) {
    for (const dept of DEPARTMENTS) {
      try {
        const items = await crawlRegionDepartment(region, dept);

        const fileName = `${region.code}_${dept.code}.json`;
        const filePath = path.join(DATA_DIR, fileName);

        await fs.writeFile(filePath, JSON.stringify(items, null, 2), 'utf-8');

        log.info(
          `Saved ${items.length} records to ${fileName}`
        );
        grandTotal += items.length;

        await delay(DELAY_MS);
      } catch (err) {
        log.error(`Failed crawling ${region.name} / ${dept.name}`, err);
      }
    }
  }

  log.info(`Crawl complete. Total records: ${grandTotal}`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
