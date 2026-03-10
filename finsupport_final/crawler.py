#!/usr/bin/env python3
"""
독립 실행 크롤링 스크립트
GitHub Actions 또는 로컬에서 실행 가능.
네이버페이 파트너 API에서 공고 데이터를 수집하여 Supabase에 저장.
"""

import asyncio
import aiohttp
import logging
import os
import sys
from datetime import datetime
from bs4 import BeautifulSoup
from supabase import create_client

from code_map import INDUSTRY_CODE_MAP

# ──────────────────────────────────────
# Supabase 설정 (환경변수 우선, 없으면 기본값)
# ──────────────────────────────────────
_DEFAULT_URL = "https://iqbfrlvujjkuluuofyjn.supabase.co"
_DEFAULT_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxYmZybHZ1amprdWx1dW9meWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3OTk5OTcsImV4cCI6MjA2MzM3NTk5N30.ikcYxfp5IveUafZwRsVOhlXqXJ3jqae9hsWIWB5lF80"
SUPABASE_URL = os.environ.get("SUPABASE_URL") or _DEFAULT_URL
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or _DEFAULT_KEY

# ──────────────────────────────────────
# 로깅 설정
# ──────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)


def get_supabase_client():
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def get_existing_subvention_ids():
    """DB에서 기존 subvention_id 목록을 가져와서 set으로 반환"""
    try:
        supabase = get_supabase_client()
        all_ids = set()
        page_size = 1000
        offset = 0

        while True:
            result = supabase.table("Finsupport Data").select("subvention_id").range(offset, offset + page_size - 1).execute()
            if not result.data:
                break
            all_ids.update(item['subvention_id'] for item in result.data)
            if len(result.data) < page_size:
                break
            offset += page_size

        logger.info(f"기존 공고 ID {len(all_ids)}개 로드 완료")
        return all_ids
    except Exception as e:
        logger.error(f"기존 ID 조회 실패: {e}")
        return set()


def save_to_supabase(data_list, industry=None, area=None, district=None):
    """크롤링 결과를 Supabase에 저장 (중복 방지)"""
    try:
        supabase = get_supabase_client()
        business_type_code = INDUSTRY_CODE_MAP.get(industry, "ALL") if industry else "ALL"

        existing_ids = []
        try:
            existing_data = supabase.table("Finsupport Data").select("subvention_id").execute()
            existing_ids = [item['subvention_id'] for item in existing_data.data]
        except Exception as e:
            logger.warning(f"기존 데이터 확인 실패: {e}")

        new_data_to_insert = []
        for item in data_list:
            if item['subventionId'] not in existing_ids:
                actual_business_code = item.get('businessTypeCode', business_type_code)
                supabase_data = {
                    'area': item['지역'],
                    'institution': item['접수기관'],
                    'subvention_title': item['지원사업명'],
                    'support_method': item['지원 방식'],
                    'support_amount': item['지원금액'],
                    'interest_rate': item['금리'],
                    'reception_end_date': item['접수 마감일'],
                    'application_method': item['접수 방법'],
                    'subvention_url': item['공고 URL'],
                    'source_name': item['출처'],
                    'attachments': item['첨부파일'],
                    'subvention_id': item['subventionId'],
                    'business_type_code': actual_business_code,
                    'collected_industry': industry,
                    'collected_area': area,
                    'collected_district': district
                }
                new_data_to_insert.append(supabase_data)

        if new_data_to_insert:
            result = supabase.table("Finsupport Data").insert(new_data_to_insert).execute()
            logger.info(f"Supabase에 {len(new_data_to_insert)}개의 새로운 데이터를 저장했습니다.")
        else:
            logger.info("중복되지 않은 새로운 데이터가 없어 저장하지 않았습니다.")

    except Exception as e:
        logger.error(f"Supabase 저장 중 오류 발생: {e}")


# ──────────────────────────────────────
# 크롤링 함수
# ──────────────────────────────────────
async def scrape_detail_page(session, subvention_id, semaphore, max_retries=5, retry_delay=3):
    """공고 상세 페이지 스크래핑 (재시도 로직 포함)"""
    async with semaphore:
        url = f"https://internal.pay.naver.com/partner/api/subvention/detail/{subvention_id}"
        retries = 0

        while retries < max_retries:
            try:
                timeout = aiohttp.ClientTimeout(total=30)
                async with session.get(url, timeout=timeout) as response:
                    if response.status == 200:
                        data = await response.json()

                        if not data or "data" not in data:
                            logger.warning(f"{subvention_id}의 상세 데이터가 비어 있습니다.")
                            return None

                        details = data["data"]

                        area = ", ".join(
                            [a.get("areaName", "확인 필요") or "확인 필요" for a in details.get("subventionAreaList", []) if a]
                        ) or "확인 필요"
                        institution = details.get("receptionInstitutionName", "확인 필요") or "확인 필요"
                        subvention_title = details.get("subventionTitleName", "확인 필요") or "확인 필요"
                        support_method = ", ".join(
                            [m.get("description", "확인 필요") or "확인 필요" for m in details.get("subventionSupportMethodCodeList", []) if m]
                        ) or "확인 필요"
                        support_amount = f"{details.get('supportAmount', 0):,} 원" if details.get("supportAmount") else "확인 필요"

                        reception_end_date = details.get("receptionEndYmd", "확인 필요") or "확인 필요"
                        subvention_url = details.get(
                            "subventionUrlAddress", f"https://finsupport.naver.com/subvention/detail/{subvention_id}"
                        ) or f"https://finsupport.naver.com/subvention/detail/{subvention_id}"
                        source_name = details.get("sourceName", "확인 필요") or "확인 필요"

                        lowest_interest = details.get("lowestInterest")
                        highest_interest = details.get("highestInterest")
                        if lowest_interest and highest_interest:
                            interest_rate = f"{lowest_interest}% ~ {highest_interest}%"
                        elif lowest_interest:
                            interest_rate = f"{lowest_interest}% 이상"
                        elif highest_interest:
                            interest_rate = f"{highest_interest}% 이하"
                        else:
                            interest_rate = "확인 필요"

                        application_way_html = details.get("applicationWayHtmlContent")
                        application_method = "확인 필요"
                        if application_way_html:
                            try:
                                if "<" in application_way_html and ">" in application_way_html:
                                    soup = BeautifulSoup(application_way_html, "html.parser")
                                    application_method = soup.get_text(" ", strip=True)
                                else:
                                    application_method = application_way_html.strip()
                            except Exception:
                                application_method = "확인 필요"

                        attachments = "\n".join(
                            [
                                f"{file.get('linkFileName', '파일 이름 없음')}: {file.get('linkFileUrlAddress', '링크 없음')}"
                                for file in details.get("subventionFileList", []) if file
                            ]
                        ) if details.get("appendixFileYn") == "Y" else "확인 필요"

                        business_type_code = "ALL"
                        if "businessTypeCode" in details:
                            business_type_code = details["businessTypeCode"]
                        elif "subventionBusinessTypeCodeList" in details:
                            business_codes = details["subventionBusinessTypeCodeList"]
                            if business_codes and len(business_codes) > 0:
                                business_type_code = business_codes[0].get("businessTypeCode", "ALL")

                        return {
                            "지역": area,
                            "접수기관": institution,
                            "지원사업명": subvention_title,
                            "지원 방식": support_method,
                            "지원금액": support_amount,
                            "금리": interest_rate,
                            "접수 마감일": reception_end_date,
                            "접수 방법": application_method,
                            "공고 URL": subvention_url,
                            "출처": source_name,
                            "첨부파일": attachments,
                            "subventionId": subvention_id,
                            "businessTypeCode": business_type_code,
                        }
                    elif response.status in [429, 500, 502, 503, 504]:
                        retries += 1
                        backoff_delay = retry_delay * (2 ** (retries - 1))
                        logger.warning(f"{subvention_id} 요청 중 {response.status} 오류. {retries}/{max_retries}회 재시도... {backoff_delay}초 대기.")
                        await asyncio.sleep(backoff_delay)
                    else:
                        logger.error(f"{subvention_id} 상세 정보 실패. 상태 코드: {response.status}")
                        return None
            except asyncio.TimeoutError:
                retries += 1
                backoff_delay = retry_delay * (2 ** (retries - 1))
                logger.warning(f"{subvention_id} 타임아웃. {retries}/{max_retries}회 재시도... {backoff_delay}초 대기.")
                await asyncio.sleep(backoff_delay)
            except Exception as e:
                retries += 1
                backoff_delay = retry_delay * (2 ** (retries - 1))
                logger.warning(f"{subvention_id} 오류: {e}. {retries}/{max_retries}회 재시도... {backoff_delay}초 대기.")
                await asyncio.sleep(backoff_delay)

        logger.error(f"{subvention_id} 최종 실패: 모든 재시도 소진")
        return None


async def fetch_subvention_ids(session, page_number, industry):
    """목록 API에서 공고 ID 목록 가져오기"""
    url = "https://internal.pay.naver.com/partner/api/subvention/list"
    headers = {"Content-Type": "application/json"}

    business_type_code = INDUSTRY_CODE_MAP.get(industry)
    params = {
        "isActive": "Y",
        "page": page_number,
        "size": 30,
        "sort": "ACCURACY",
    }
    if business_type_code and business_type_code != "ALL":
        params["businessTypeCode"] = business_type_code

    try:
        async with session.get(url, params=params, headers=headers) as response:
            if response.status == 200:
                data = await response.json()
                if not data or "data" not in data or not data["data"]["content"]:
                    return []
                await asyncio.sleep(0.5)
                return [subvention['subventionId'] for subvention in data['data']['content']]
            else:
                logger.error(f"페이지 {page_number} 실패. 상태 코드: {response.status}")
                return []
    except Exception as e:
        logger.error(f"API 요청 중 오류 발생: {e}")
        return []


async def crawl_all_data():
    """전체 업종별 공고 크롤링 메인 함수"""
    logger.info("=" * 50)
    logger.info(f"공고 크롤링 시작 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info("=" * 50)

    # 기존 공고 ID 로드
    logger.info("기존 공고 ID 목록 확인 중...")
    existing_ids = get_existing_subvention_ids()
    logger.info(f"기존 공고 {len(existing_ids)}개 확인됨. 크롤링 시작...")

    async with aiohttp.ClientSession() as session:
        all_data_with_codes = []
        industry_codes = [key for key in INDUSTRY_CODE_MAP.keys() if key != "전체"]

        async def collect_industry_data(industry):
            """업종별 데이터 수집"""
            logger.info(f"[{industry}] 데이터 수집 중...")

            page_number = 0
            industry_subvention_ids = []

            while True:
                subvention_ids = await fetch_subvention_ids(session, page_number, industry)
                if not subvention_ids:
                    break
                industry_subvention_ids.extend(subvention_ids)
                page_number += 1

            if industry_subvention_ids:
                new_ids = [id for id in industry_subvention_ids if id not in existing_ids]
                logger.info(f"[{industry}] {len(industry_subvention_ids)}개 중 {len(new_ids)}개 신규 공고")

                if new_ids:
                    semaphore = asyncio.Semaphore(5)
                    tasks = [
                        scrape_detail_page(session, subvention_id, semaphore)
                        for subvention_id in new_ids
                    ]
                    results = await asyncio.gather(*tasks)
                else:
                    results = []

                business_type_code = INDUSTRY_CODE_MAP[industry]
                industry_data = []
                for result in results:
                    if result:
                        result["businessTypeCode"] = business_type_code
                        industry_data.append(result)

                return industry_data
            return []

        # 업종을 3개씩 배치 처리
        batch_size = 3
        total_batches = (len(industry_codes) - 1) // batch_size + 1
        for i in range(0, len(industry_codes), batch_size):
            batch_industries = industry_codes[i:i+batch_size]
            batch_num = i // batch_size + 1
            logger.info(f"배치 {batch_num}/{total_batches} 처리 중: {', '.join(batch_industries)}")

            batch_tasks = [collect_industry_data(industry) for industry in batch_industries]
            batch_results = await asyncio.gather(*batch_tasks)

            for industry_data in batch_results:
                all_data_with_codes.extend(industry_data)

            if i + batch_size < len(industry_codes):
                await asyncio.sleep(3)

        if not all_data_with_codes:
            logger.info("신규 공고 데이터가 없습니다.")
            return

        successful_data = [item for item in all_data_with_codes if item is not None]
        logger.info(f"총 {len(successful_data)}개 수집 완료. 중복 제거 중...")

        # 중복 제거 (같은 공고가 여러 업종에 포함될 수 있음)
        unique_data = {}
        for item in successful_data:
            subvention_id = item['subventionId']
            if subvention_id not in unique_data:
                unique_data[subvention_id] = item
            else:
                existing_codes = unique_data[subvention_id]['businessTypeCode'].split(',')
                new_code = item['businessTypeCode']
                if new_code not in existing_codes:
                    existing_codes.append(new_code)
                    unique_data[subvention_id]['businessTypeCode'] = ','.join(existing_codes)

        final_data = list(unique_data.values())
        logger.info(f"중복 제거 완료: {len(final_data)}개 고유 공고. Supabase 저장 중...")

        save_to_supabase(final_data, "전체", "전체", "전체")

    logger.info("=" * 50)
    logger.info(f"크롤링 완료 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info("=" * 50)


if __name__ == "__main__":
    asyncio.run(crawl_all_data())
