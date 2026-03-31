import os
import logging
from datetime import datetime, timedelta
from supabase import create_client, Client
from code_map import *

# Supabase 설정
SUPABASE_URL = "https://qykuzouyjxjizitzpzoo.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5a3V6b3V5anhqaXppdHpwem9vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NjM0NDcsImV4cCI6MjA4OTQzOTQ0N30.cbXY_OxvOc0tIJQJ18HAdWKhUGMMywb9fdADFaflFEg"

# Supabase 클라이언트 생성
def get_supabase_client():
    return create_client(SUPABASE_URL, SUPABASE_KEY)

# 한국어 요일 변환 함수
def get_korean_day_of_week():
    days = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일']
    return days[datetime.today().weekday()]

# 로그 파일 설정
def setup_logging():
    log_dir = "logs"
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)
    log_filename = f"logs/error_{datetime.today().strftime('%Y%m%d')}.log"
    logging.basicConfig(
        filename=log_filename,
        filemode="a",
        format="%(asctime)s - %(levelname)s - %(message)s",
        level=logging.ERROR,
        encoding="utf-8"
    )
    cleanup_old_logs(log_dir)

def cleanup_old_logs(log_dir, days=7):
    now = datetime.now()
    cutoff_date = now - timedelta(days=days)
    for filename in os.listdir(log_dir):
        if filename.startswith("error_") and filename.endswith(".log"):
            file_path = os.path.join(log_dir, filename)
            file_time = datetime.fromtimestamp(os.path.getmtime(file_path))
            if file_time < cutoff_date:
                os.remove(file_path)
                logging.info(f"오래된 로그 파일 삭제됨: {filename}")

# Supabase에 데이터 저장 함수 (공고 데이터 + 수집 조건 저장)
def save_to_supabase(data_list, log_var, industry=None, area=None, district=None):
    try:
        supabase = get_supabase_client()

        # 업종 코드 변환
        business_type_code = INDUSTRY_CODE_MAP.get(industry, "ALL") if industry else "ALL"

        # 기존 데이터 확인 (중복 방지)
        existing_ids = []
        try:
            existing_data = supabase.table("Finsupport Data").select("subvention_id").execute()
            existing_ids = [item['subvention_id'] for item in existing_data.data]
        except Exception as e:
            logging.warning(f"기존 데이터 확인 실패: {e}")

        # 새로운 데이터만 필터링
        new_data_to_insert = []
        for item in data_list:
            if item['subventionId'] not in existing_ids:
                # 각 공고의 실제 업종 코드 사용 (있는 경우), 없으면 수집 조건의 업종 코드 사용
                actual_business_code = item.get('businessTypeCode', business_type_code)

                # Supabase 테이블 형식에 맞게 데이터 변환 (공고 정보 + 수집 조건)
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
            # 데이터 삽입
            result = supabase.table("Finsupport Data").insert(new_data_to_insert).execute()
            log_var.set(f"Supabase에 {len(new_data_to_insert)}개의 새로운 데이터를 저장했습니다.")
            logging.info(f"Supabase에 {len(new_data_to_insert)}개의 데이터 저장 완료")
        else:
            log_var.set("중복되지 않은 새로운 데이터가 없어 Supabase에 저장하지 않았습니다.")

    except Exception as e:
        error_msg = f"Supabase 저장 중 오류 발생: {e}"
        log_var.set(error_msg)
        logging.error(error_msg)

# 기존 공고 ID 가져오기 함수 (중복 방지용)
def get_existing_subvention_ids():
    """DB에서 기존 subvention_id 목록을 가져와서 set으로 반환"""
    try:
        supabase = get_supabase_client()
        result = supabase.table("Finsupport Data").select("subvention_id").execute()
        existing_ids = set(item['subvention_id'] for item in result.data)
        logging.info(f"기존 공고 ID {len(existing_ids)}개 로드 완료")
        return existing_ids
    except Exception as e:
        logging.error(f"기존 ID 조회 실패: {e}")
        return set()

# 팀장-업체 관리 함수들
def save_company_info(team_leader, company_name, industry, area, district):
    try:
        supabase = get_supabase_client()

        # 새로운 업체 데이터 저장
        company_data = {
            "team_leader": team_leader,
            "company_name": company_name,
            "industry": industry,
            "area": area,
            "district": district,
            "is_active": True
        }
        result = supabase.table("Team Management").insert(company_data).execute()
        return True

    except Exception as e:
        return False

def get_all_team_leaders():
    try:
        supabase = get_supabase_client()
        result = supabase.table("Team Management").select("team_leader").eq("is_active", True).execute()
        team_leaders = list(set([item["team_leader"] for item in result.data]))
        return team_leaders
    except Exception as e:
        logging.error(f"팀장 목록 조회 오류: {e}")
        return []

def get_team_companies(team_leader):
    try:
        supabase = get_supabase_client()
        result = supabase.table("Team Management").select("*").eq("team_leader", team_leader).eq("is_active", True).execute()
        return result.data
    except Exception as e:
        logging.error(f"팀 업체 정보 조회 오류: {e}")
        return []

def get_all_companies():
    try:
        supabase = get_supabase_client()
        result = supabase.table("Team Management").select("*").eq("is_active", True).execute()
        return result.data
    except Exception as e:
        logging.error(f"전체 업체 정보 조회 오류: {e}")
        return []

def update_company(company_id, team_leader, company_name, industry, area, district):
    """업체 정보 업데이트"""
    try:
        supabase = get_supabase_client()
        supabase.table("Team Management").update({
            "team_leader": team_leader,
            "company_name": company_name,
            "industry": industry,
            "area": area,
            "district": district
        }).eq("id", company_id).execute()
        return True
    except Exception as e:
        logging.error(f"업체 정보 업데이트 오류: {e}")
        return False

def delete_company(company_id):
    try:
        supabase = get_supabase_client()
        supabase.table("Team Management").update({"is_active": False}).eq("id", company_id).execute()
        return True
    except Exception as e:
        logging.error(f"업체 삭제 오류: {e}")
        return False

# 공고 다운로드 히스토리 관리 함수들
def save_download_history(team_leader, company_id, company_name, subvention_ids, download_date=None):
    """업체별 공고 다운로드 이력 저장"""
    try:
        supabase = get_supabase_client()

        if download_date is None:
            download_date = datetime.now().isoformat()

        # 각 공고 ID별로 히스토리 저장
        history_data = []
        for subvention_id in subvention_ids:
            history_data.append({
                "team_leader": team_leader,
                "company_id": company_id,
                "company_name": company_name,
                "subvention_id": subvention_id,
                "download_date": download_date
            })

        # 배치로 히스토리 저장
        if history_data:
            supabase.table("Download History").insert(history_data).execute()
            logging.info(f"{company_name}에게 {len(subvention_ids)}개 공고 전달 이력 저장")

        return True
    except Exception as e:
        # 테이블이 없는 경우 일단 성공으로 처리 (로그만 남김)
        logging.warning(f"다운로드 히스토리 저장 실패 (테이블 없음): {e}")
        return True

def get_company_download_history(company_id):
    """업체별 오늘 다운로드 받은 공고 ID 목록 반환 (같은 날 중복 방지, 다른 날은 허용)"""
    try:
        supabase = get_supabase_client()
        today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        downloaded_ids = set()
        page_size = 1000
        offset = 0
        while True:
            result = supabase.table("Download History").select("subvention_id").eq("company_id", company_id).gte("download_date", today_start).order("id").range(offset, offset + page_size - 1).execute()
            if not result.data:
                break
            downloaded_ids.update(item['subvention_id'] for item in result.data)
            if len(result.data) < page_size:
                break
            offset += page_size
        return downloaded_ids
    except Exception as e:
        logging.warning(f"다운로드 히스토리 조회 실패: {e}")
        return set()

def is_new_company(company_id):
    """신규 업체인지 확인 (다운로드 이력이 없으면 신규)"""
    try:
        supabase = get_supabase_client()
        result = supabase.table("Download History").select("id").eq("company_id", company_id).limit(1).execute()
        return len(result.data) == 0
    except Exception as e:
        # 테이블이 없는 경우 모든 업체를 신규로 간주
        logging.warning(f"신규 업체 확인 실패 (테이블 없음): {e}")
        return True

def get_download_history_records(team_leader=None, max_records=5000):
    """다운로드 히스토리 레코드 조회 (히스토리 뷰어용, 페이지네이션 적용)"""
    try:
        supabase = get_supabase_client()
        all_data = []
        page_size = 1000  # Supabase 기본 최대 행 수
        offset = 0

        while offset < max_records:
            query = supabase.table("Download History").select("*")

            if team_leader:
                query = query.eq("team_leader", team_leader)

            query = query.order("download_date", desc=True).range(offset, offset + page_size - 1)
            result = query.execute()

            if not result.data:
                break

            all_data.extend(result.data)
            offset += page_size

            # 가져온 데이터가 page_size보다 작으면 더 이상 없음
            if len(result.data) < page_size:
                break

        return all_data
    except Exception as e:
        logging.warning(f"다운로드 히스토리 레코드 조회 실패: {e}")
        return []

def get_subventions_by_ids(subvention_ids):
    """특정 subvention_id 목록에 해당하는 공고 데이터 조회 (재다운로드용)"""
    try:
        supabase = get_supabase_client()
        result = supabase.table("Finsupport Data").select("*").in_("subvention_id", subvention_ids).execute()
        return result.data
    except Exception as e:
        logging.error(f"공고 데이터 조회 실패: {e}")
        return []
