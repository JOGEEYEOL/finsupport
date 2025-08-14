import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-firestore.js";
import { db } from "../core/firebase-config.js";
import { decryptSSN } from "../core/encryption.js";
import { showAlert } from "./modal-manager.js";

/**
 * 위촉자 조회 컴포넌트
 * manager와 admin 페이지에서 공통으로 사용 가능
 */
export class ApplicantViewer {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    this.currentApplicants = [];
    this.examSchedules = []; // 자격시험 일정 데이터 저장
    
    // 옵션 설정
    this.options = {
      showManagerFilter: true,    // 담당자 필터 표시 여부 (admin에서 true)
      currentManager: null,       // 현재 담당자 (manager에서 설정)
      showStats: false,          // 통계 표시 여부 (기본값: 제거)
      searchPlaceholder: '성명, 전화번호, 시험일로 검색',
      ...options
    };
    
    if (!this.container) {
      throw new Error(`Container with id "${containerId}" not found`);
    }

    this.setupEventListeners();
  }

  /**
   * 컴포넌트 초기화
   */
  async initialize() {
    this.renderUI();
    await this.loadExamSchedules(); // 자격시험 일정 먼저 로드
    await this.loadApplicants();
  }

  /**
   * 자격시험 일정 데이터 로드
   */
  async loadExamSchedules() {
    try {
      const { getLifeInsuranceExamSchedules } = await import('../services/exam-service.js');
      const result = await getLifeInsuranceExamSchedules();
      
      if (result.success && result.schedules) {
        this.examSchedules = result.schedules;
      }
    } catch (error) {
      console.warn('자격시험 일정 로드 실패:', error);
      this.examSchedules = [];
    }
  }

  /**
   * UI 렌더링
   */
  renderUI() {
    const statsHTML = this.options.showStats ? this.renderStatsSection() : '';
    const managerFilterHTML = this.options.showManagerFilter ? this.renderManagerFilter() : '';
    const pageTitle = this.options.showManagerFilter ? '위촉자 조회' : '위촉자 조회';
    const pageDescription = this.options.showManagerFilter ? 
      '전체 담당자의 위촉자 정보를 조회하고 관리합니다.' : 
      '내가 담당하는 위촉자 정보를 조회합니다.';
    
    this.container.innerHTML = `
      <div style="text-align: center; margin-bottom: 24px;">
        <h3 style="margin: 0 0 8px 0; color: #2c3e50; font-size: 24px; font-weight: 600;">
          ${pageTitle}
        </h3>
        <p style="margin: 0; color: #666; font-size: 14px;">
          ${pageDescription}
        </p>
      </div>
      
      ${statsHTML}
      
      <div class="search-area">
        ${managerFilterHTML}
        <div class="search-input-group">
          <input type="text" id="applicant-search" placeholder="${this.options.searchPlaceholder}" />
          <button type="button" id="applicant-search-reset" class="search-reset-btn" aria-label="초기화">
            <i class="fas fa-redo-alt"></i>
          </button>
        </div>
        <button type="button" id="applicant-excel-download" class="excel-download-btn" style="background: #27ae60; color: white; padding: 12px 16px; border: none; border-radius: 5px; cursor: pointer; margin-left: 8px;">
          <i class="fas fa-file-excel"></i> 엑셀 다운로드
        </button>
      </div>
      
      <div id="applicant-list" class="card-list"></div>
    `;
  }

  /**
   * 통계 섹션 렌더링
   */
  renderStatsSection() {
    return `
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-icon">
            <i class="fas fa-users"></i>
          </div>
          <div class="stat-content">
            <div class="stat-number" id="total-applicants">0</div>
            <div class="stat-label">총 위촉자</div>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">
            <i class="fas fa-clock"></i>
          </div>
          <div class="stat-content">
            <div class="stat-number" id="recent-applicants">0</div>
            <div class="stat-label">최근 7일</div>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">
            <i class="fas fa-calendar-check"></i>
          </div>
          <div class="stat-content">
            <div class="stat-number" id="upcoming-exams">0</div>
            <div class="stat-label">예정된 시험</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 담당자 필터 렌더링 (admin용)
   */
  renderManagerFilter() {
    return `
      <select id="manager-filter">
        <option value="">전체 담당자</option>
      </select>
    `;
  }

  /**
   * 이벤트 리스너 설정
   */
  setupEventListeners() {
    // 검색 기능
    document.addEventListener('input', (e) => {
      if (e.target.id === 'applicant-search') {
        const searchTerm = e.target.value.toLowerCase().trim();
        this.filterApplicants(searchTerm);
      }
    });

    // 검색 초기화
    document.addEventListener('click', (e) => {
      if (e.target.id === 'applicant-search-reset' || e.target.closest('#applicant-search-reset')) {
        const searchInput = document.getElementById('applicant-search');
        if (searchInput) {
          searchInput.value = '';
          this.filterApplicants('');
        }
      }
    });

    // 담당자 필터 (admin용)
    document.addEventListener('change', (e) => {
      if (e.target.id === 'manager-filter') {
        const selectedManager = e.target.value;
        this.filterByManager(selectedManager);
      }
    });

    // 엑셀 다운로드 버튼
    document.addEventListener('click', (e) => {
      if (e.target.id === 'applicant-excel-download' || e.target.closest('#applicant-excel-download')) {
        this.downloadExcel();
      }
    });
  }

  /**
   * 위촉자 데이터 로드
   */
  async loadApplicants() {
    try {
      // 로딩 표시
      this.showLoading();

      // 쿼리 설정
      const applicantsRef = collection(db, 'applicants');
      let q;
      
      if (this.options.currentManager) {
        // manager 페이지: 특정 담당자의 위촉자만
        q = query(applicantsRef, where('managerCode', '==', this.options.currentManager.code));
      } else {
        // admin 페이지: 모든 위촉자
        q = applicantsRef;
      }

      const querySnapshot = await getDocs(q);
      this.currentApplicants = [];
      
      querySnapshot.forEach((doc) => {
        this.currentApplicants.push({ id: doc.id, ...doc.data() });
      });

      // 클라이언트에서 최신순 정렬
      this.currentApplicants.sort((a, b) => {
        const dateA = a.created_at?.toDate ? a.created_at.toDate() : new Date(a.created_at || 0);
        const dateB = b.created_at?.toDate ? b.created_at.toDate() : new Date(b.created_at || 0);
        return dateB - dateA;
      });

      // 통계 업데이트
      if (this.options.showStats) {
        this.updateStats();
      }

      // admin용 담당자 필터 로드
      if (this.options.showManagerFilter) {
        await this.loadManagerFilter();
      }
      
      // 위촉자 목록 렌더링
      this.renderApplicantList(this.currentApplicants);

    } catch (error) {
      console.error('위촉자 정보 로드 실패:', error);
      showAlert('위촉자 정보를 불러오는데 실패했습니다: ' + error.message);
      this.showError('위촉자 정보를 불러올 수 없습니다.');
    }
  }

  /**
   * 담당자 필터 로드 (admin용)
   */
  async loadManagerFilter() {
    try {
      // 위촉자 데이터에서 담당자 코드 추출
      const managerCodes = [...new Set(this.currentApplicants.map(a => a.managerCode).filter(Boolean))];
      
      // 담당자 정보 로드
      const managersRef = collection(db, 'managers');
      const managersSnapshot = await getDocs(managersRef);
      const managers = {};
      
      managersSnapshot.forEach((doc) => {
        const manager = doc.data();
        managers[manager.code] = manager;
      });

      // 필터 옵션 업데이트
      const managerFilter = document.getElementById('manager-filter');
      if (managerFilter) {
        managerFilter.innerHTML = '<option value="">전체 담당자</option>';
        
        managerCodes.forEach(code => {
          const manager = managers[code];
          if (manager) {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = `${manager.name} (${code})`;
            managerFilter.appendChild(option);
          }
        });
      }
    } catch (error) {
      console.error('담당자 필터 로드 실패:', error);
    }
  }

  /**
   * 통계 업데이트
   */
  updateStats() {
    const totalApplicants = this.currentApplicants.length;
    
    // 최근 7일 계산
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentApplicants = this.currentApplicants.filter(applicant => {
      const createdDate = applicant.created_at?.toDate ? applicant.created_at.toDate() : new Date(applicant.created_at);
      return createdDate >= sevenDaysAgo;
    }).length;

    // 예정된 시험 계산 (오늘 이후 시험일)
    const today = new Date();
    const upcomingExams = this.currentApplicants.filter(applicant => {
      if (!applicant.examId) return false;
      const examData = this.parseExamIdToData(applicant.examId);
      if (!examData?.examDate) return false;
      return new Date(examData.examDate) > today;
    }).length;

    // UI 업데이트
    const totalElement = document.getElementById('total-applicants');
    const recentElement = document.getElementById('recent-applicants');
    const upcomingElement = document.getElementById('upcoming-exams');

    if (totalElement) totalElement.textContent = totalApplicants;
    if (recentElement) recentElement.textContent = recentApplicants;
    if (upcomingElement) upcomingElement.textContent = upcomingExams;
  }

  /**
   * 위촉자 목록 렌더링
   */
  renderApplicantList(applicants) {
    const applicantList = document.getElementById('applicant-list');
    
    if (applicants.length === 0) {
      applicantList.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #666;">
          <i class="fas fa-user-plus" style="font-size: 48px; margin-bottom: 20px; opacity: 0.5;"></i>
          <p>등록된 위촉자가 없습니다.</p>
        </div>
      `;
      return;
    }

    let html = '';
    applicants.forEach(applicant => {
      const createdDate = applicant.created_at?.toDate ? applicant.created_at.toDate() : new Date(applicant.created_at);
      const formattedDate = createdDate.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });

      // examId에서 시험일과 지역 정보 추출
      let examDate = '';
      let region = '';
      let examRound = '';
      if (applicant.examId) {
        const examData = this.parseExamIdToData(applicant.examId);
        if (examData) {
          examDate = examData.examDate;
          region = examData.region;
          examRound = this.getExamRound(examData.examDate, examData.region);
        }
      }

      // 담당자 정보 (admin에서만 표시)
      const managerInfo = this.options.showManagerFilter ? `
        <div class="info-item">
          <i class="fas fa-user-tie"></i>
          <span>담당자: ${applicant.managerCode || '미지정'}</span>
        </div>
      ` : '';

      html += `
        <div class="client-card" onclick="window.applicantViewer.viewApplicantDetail('${applicant.id}')">
          <div class="card-header">
            <h4>${applicant.name || '이름 없음'}</h4>
            <span class="date">${formattedDate}</span>
          </div>
          <div class="card-body">
            <div class="info-item">
              <i class="fas fa-phone"></i>
              <span>${applicant.phone || '연락처 없음'}</span>
            </div>
            ${examDate ? `
              <div class="info-item">
                <i class="fas fa-calendar-alt"></i>
                <span>시험일: ${examDate}${examRound ? ` (${examRound})` : ''}</span>
              </div>
            ` : ''}
            ${region ? `
              <div class="info-item">
                <i class="fas fa-map-marker-alt"></i>
                <span>지역: ${region}</span>
              </div>
            ` : ''}
            ${managerInfo}
          </div>
        </div>
      `;
    });
    
    applicantList.innerHTML = html;
  }

  /**
   * 위촉자 검색 필터링
   */
  filterApplicants(searchTerm) {
    if (!searchTerm) {
      this.renderApplicantList(this.currentApplicants);
      return;
    }

    const filteredApplicants = this.currentApplicants.filter(applicant => {
      // examId에서 시험일과 지역 정보 추출
      let examDate = '';
      let region = '';
      if (applicant.examId) {
        const examData = this.parseExamIdToData(applicant.examId);
        if (examData) {
          examDate = examData.examDate;
          region = examData.region;
        }
      }

      return (applicant.name && applicant.name.toLowerCase().includes(searchTerm)) ||
             (applicant.phone && applicant.phone.toLowerCase().includes(searchTerm)) ||
             (examDate && examDate.toLowerCase().includes(searchTerm)) ||
             (region && region.toLowerCase().includes(searchTerm)) ||
             (applicant.managerCode && applicant.managerCode.toLowerCase().includes(searchTerm));
    });

    this.renderApplicantList(filteredApplicants);
  }

  /**
   * 담당자별 필터링 (admin용)
   */
  filterByManager(managerCode) {
    if (!managerCode) {
      this.renderApplicantList(this.currentApplicants);
      return;
    }

    const filteredApplicants = this.currentApplicants.filter(applicant => 
      applicant.managerCode === managerCode
    );

    this.renderApplicantList(filteredApplicants);
  }

  /**
   * 위촉자 상세 정보 보기
   */
  async viewApplicantDetail(applicantId) {
    const applicant = this.currentApplicants.find(a => a.id === applicantId);
    if (!applicant) {
      showAlert('위촉자 정보를 찾을 수 없습니다.');
      return;
    }

    try {
      // 주민등록번호 복호화
      const decryptedSSN = await decryptSSN(applicant.ssn);

      // 등록일 포맷팅
      const createdAt = applicant.created_at?.toDate ? applicant.created_at.toDate() : new Date(applicant.created_at);
      const dateStr = createdAt.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });

      // 담당자 정보 로드
      const managerInfo = await this.getManagerInfo(applicant.managerCode);

      // 모달 생성 및 표시
      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.style.display = 'block';
      
      modal.innerHTML = `
        <div class="modal-content" style="max-width: 800px; max-height: 90vh; overflow-y: auto;">
          <div class="modal-header">
            <h3><i class="fas fa-user-plus"></i> ${applicant.name || '위촉자'}님 상세 정보</h3>
            <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
          </div>
          
          <div class="modal-body">
            <!-- 기본 정보 -->
            <div class="detail-section">
              <h5><i class="fas fa-user"></i> 기본 정보</h5>
              <div class="detail-grid">
                <div class="detail-item">
                  <label>이름:</label>
                  <span>${applicant.name || '-'}</span>
                </div>
                <div class="detail-item">
                  <label>주민등록번호:</label>
                  <span>${decryptedSSN || '-'}</span>
                </div>
                <div class="detail-item">
                  <label>등록일:</label>
                  <span>${dateStr}</span>
                </div>
              </div>
            </div>
            
            <!-- 연락처 정보 -->
            <div class="detail-section">
              <h5><i class="fas fa-phone"></i> 연락처 정보</h5>
              <div class="detail-grid">
                <div class="detail-item">
                  <label>통신사:</label>
                  <span>${applicant.phoneCarrier || '-'}</span>
                </div>
                <div class="detail-item">
                  <label>핸드폰번호:</label>
                  <span>${applicant.phone || '-'}</span>
                </div>
                <div class="detail-item">
                  <label>이메일:</label>
                  <span>${applicant.email || '-'}</span>
                </div>
              </div>
            </div>
            
            <!-- 주소 정보 -->
            <div class="detail-section">
              <h5><i class="fas fa-map-marker-alt"></i> 주소 정보</h5>
              <div class="detail-grid">
                <div class="detail-item">
                  <label>우편번호:</label>
                  <span>${applicant.postcode || '-'}</span>
                </div>
                <div class="detail-item full-width">
                  <label>주소:</label>
                  <span>${applicant.address || '-'}</span>
                </div>
                <div class="detail-item full-width">
                  <label>상세주소:</label>
                  <span>${applicant.addressDetail || '-'}</span>
                </div>
              </div>
            </div>
            
            <!-- 계좌 정보 -->
            <div class="detail-section">
              <h5><i class="fas fa-university"></i> 계좌 정보</h5>
              <div class="detail-grid">
                <div class="detail-item">
                  <label>은행:</label>
                  <span>${applicant.bank || '-'}</span>
                </div>
                <div class="detail-item">
                  <label>계좌번호:</label>
                  <span>${applicant.accountNumber || '-'}</span>
                </div>
                <div class="detail-item">
                  <label>예금주:</label>
                  <span>${applicant.accountHolder || '-'}</span>
                </div>
              </div>
            </div>
            
            <!-- 학력 및 경력 -->
            <div class="detail-section">
              <h5><i class="fas fa-graduation-cap"></i> 학력 및 경력</h5>
              <div class="detail-grid">
                <div class="detail-item">
                  <label>최종 학력:</label>
                  <span>${applicant.education || '-'}</span>
                </div>
                ${applicant.schoolName ? `
                <div class="detail-item">
                  <label>학교명:</label>
                  <span>${applicant.schoolName}</span>
                </div>
                ` : ''}
                ${applicant.major ? `
                <div class="detail-item">
                  <label>전공:</label>
                  <span>${applicant.major}</span>
                </div>
                ` : ''}
                <div class="detail-item">
                  <label>경력:</label>
                  <span>${applicant.experience || '-'}</span>
                </div>
                ${applicant.experience === '경력자' ? `
                <div class="detail-item">
                  <label>경력 연차:</label>
                  <span>${applicant.experienceYears || '-'}년</span>
                </div>
                <div class="detail-item">
                  <label>이전 회사:</label>
                  <span>${applicant.prevCompany || '-'}</span>
                </div>
                ` : ''}
              </div>
            </div>

            <!-- 시험 일정 정보 -->
            <div class="detail-section" id="exam-schedule-section">
              <h5><i class="fas fa-calendar"></i> 시험 일정 정보</h5>
              <div id="exam-schedule-content">
                <div style="text-align: center; padding: 20px;">
                  <i class="fas fa-spinner fa-spin"></i> 시험 일정 정보를 불러오는 중...
                </div>
              </div>
            </div>
            
            <!-- 도입자 정보 -->
            <div class="detail-section">
              <h5><i class="fas fa-user-tie"></i> 도입자 정보</h5>
              <div class="detail-grid">
                <div class="detail-item">
                  <label>도입자명:</label>
                  <span>${managerInfo?.name || '-'}</span>
                </div>
                <div class="detail-item">
                  <label>도입자 코드:</label>
                  <span>${applicant.managerCode || '-'} ${managerInfo?.gaiaId ? `(${managerInfo.gaiaId})` : ''}</span>
                </div>
              </div>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="secondary-btn" onclick="this.closest('.modal').remove()">닫기</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      
      // 시험 일정 정보 로드 (examId가 있는 경우)
      if (applicant.examId) {
        await this.loadExamScheduleInfo(applicant.examId, modal);
      } else {
        // examId가 없는 경우 시험 일정 섹션 숨기기
        const examScheduleSection = modal.querySelector('#exam-schedule-section');
        if (examScheduleSection) {
          examScheduleSection.style.display = 'none';
        }
      }
      
      // 모달 외부 클릭 시 닫기
      modal.addEventListener('click', function(e) {
        if (e.target === modal) {
          modal.remove();
        }
      });
      
    } catch (error) {
      console.error('위촉자 상세 정보 로드 실패:', error);
      showAlert('위촉자 상세 정보를 불러오는데 실패했습니다.');
    }
  }

  /**
   * 담당자 정보 로드
   */
  async getManagerInfo(managerCode) {
    if (!managerCode) return null;
    
    try {
      const managersRef = collection(db, 'managers');
      const q = query(managersRef, where('code', '==', managerCode));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        return querySnapshot.docs[0].data();
      }
    } catch (error) {
      console.error('담당자 정보 로드 실패:', error);
    }
    
    return null;
  }

  /**
   * 시험 일정 정보 로드
   */
  async loadExamScheduleInfo(examId, modal) {
    try {
      // 합성 examId를 파싱해서 시험 정보 생성
      const examData = this.parseExamIdToData(examId);
      
      if (examData) {
        // 파싱된 시험 정보 표시
        const examScheduleContent = modal.querySelector('#exam-schedule-content');
        examScheduleContent.innerHTML = `
          <div class="detail-grid">
            <div class="detail-item">
              <label>시험명:</label>
              <span>생명보험자격시험</span>
            </div>
            <div class="detail-item">
              <label>시험일:</label>
              <span>${examData.examDate || '미정'}${this.getExamRound(examData.examDate, examData.region) ? ` (${this.getExamRound(examData.examDate, examData.region)})` : ''}</span>
            </div>
            <div class="detail-item">
              <label>지역:</label>
              <span>${examData.region || '미정'}</span>
            </div>
            <div class="detail-item">
              <label>접수 마감일:</label>
              <span>${examData.applicationPeriod || '미정'}</span>
            </div>
          </div>
        `;
      } else {
        // examId 파싱 실패
        const examScheduleContent = modal.querySelector('#exam-schedule-content');
        examScheduleContent.innerHTML = `
          <div style="text-align: center; padding: 20px; color: #666;">
            <i class="fas fa-info-circle"></i> 시험 ID(${examId})를 파싱할 수 없습니다.
          </div>
        `;
      }
    } catch (error) {
      console.error('시험 일정 정보 로드 실패:', error);
      const examScheduleContent = modal.querySelector('#exam-schedule-content');
      examScheduleContent.innerHTML = `
        <div style="text-align: center; padding: 20px; color: #666;">
          <i class="fas fa-exclamation-triangle"></i> 시험 일정 정보 로드 중 오류가 발생했습니다.
        </div>
      `;
    }
  }

  /**
   * 합성 시험 ID 파싱
   */
  parseExamIdToData(examId) {
    try {
      const parts = examId.split('_');
      if (parts.length !== 3) return null;
      
      const [examDateStr, regionCode, applicationDateStr] = parts;
      
      // 날짜 형식 변환
      const examDate = this.formatDateFromString(examDateStr);
      const applicationDate = this.formatDateFromString(applicationDateStr);
      
      // 지역 코드 변환
      const region = this.getRegionFromCode(regionCode);
      
      if (!examDate || !region) return null;
      
      // 사내 마감일 계산
      const internalDeadline = this.calculateInternalDeadline(applicationDate);
      
      return {
        id: examId,
        examDate: examDate,
        region: region,
        applicationPeriod: internalDeadline,
        resultDate: '미정',
        type: 'life_insurance'
      };
    } catch (error) {
      console.error('시험 ID 파싱 실패:', examId, error);
      return null;
    }
  }

  /**
   * 날짜 문자열 포맷팅 (YYYYMMDD -> YYYY-MM-DD)
   */
  formatDateFromString(dateStr) {
    if (!dateStr || dateStr.length !== 8) return null;
    
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    
    return `${year}-${month}-${day}`;
  }

  /**
   * 지역 코드에서 지역명 변환
   */
  getRegionFromCode(regionCode) {
    const regionMap = {
      'SEL': '서울', 'PUS': '부산', 'ICN': '인천', 'DAE': '대구',
      'GWJ': '광주', 'DJN': '대전', 'ULS': '울산', 'JEJ': '제주',
      'KRL': '강릉', 'WON': '원주', 'CCN': '춘천', 'JEO': '전주',
      'SRS': '서산', 'ALL': '전국', 'ETC': '기타'
    };
    
    return regionMap[regionCode] || null;
  }

  /**
   * 사내 마감일 계산
   */
  calculateInternalDeadline(applicationStartDate) {
    try {
      const startDate = new Date(applicationStartDate);
      if (isNaN(startDate.getTime())) {
        return `${applicationStartDate} 전날 11:00까지`;
      }
      
      const internalDate = new Date(startDate);
      internalDate.setDate(internalDate.getDate() - 1);
      
      const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
      const dayName = dayNames[internalDate.getDay()];
      
      const year = internalDate.getFullYear();
      const month = String(internalDate.getMonth() + 1).padStart(2, '0');
      const day = String(internalDate.getDate()).padStart(2, '0');
      
      return `${year}-${month}-${day}(${dayName}) 11:00까지`;
    } catch (error) {
      console.warn('내부 마감일 계산 실패:', applicationStartDate, error);
      return '미정';
    }
  }

  /**
   * 시험일로부터 차수 판별 (자격시험 일정 데이터 기반)
   */
  getExamRound(examDateStr, region) {
    if (!examDateStr || !region || !this.examSchedules.length) return '';
    
    try {
      const examDate = new Date(examDateStr);
      if (isNaN(examDate.getTime())) return '';
      
      const year = examDate.getFullYear();
      const month = examDate.getMonth() + 1;
      
      // 같은 지역, 같은 년월의 시험일들을 수집
      const sameMonthExams = [];
      this.examSchedules.forEach(schedule => {
        if (schedule.region === region) {
          // '열기' 텍스트 제거하고 날짜 추출
          const cleanScheduleDate = (schedule.examDate || '').replace(/\s*열기\s*$/, '').trim();
          const dateMatch = cleanScheduleDate.match(/(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            const scheduleExamDate = new Date(dateMatch[1]);
            if (!isNaN(scheduleExamDate.getTime()) && 
                scheduleExamDate.getFullYear() === year && 
                scheduleExamDate.getMonth() + 1 === month) {
              sameMonthExams.push(dateMatch[1]);
            }
          }
        }
      });
      
      // 중복 제거 및 날짜 순 정렬
      const uniqueExamDates = [...new Set(sameMonthExams)].sort();
      
      // 현재 시험일의 순서 찾기
      const examIndex = uniqueExamDates.indexOf(examDateStr);
      if (examIndex >= 0) {
        return `${examIndex + 1}차`;
      }
      
      return '';
    } catch (error) {
      console.warn('시험 차수 판별 실패:', examDateStr, error);
      return '';
    }
  }

  /**
   * 로딩 표시
   */
  showLoading() {
    const applicantList = document.getElementById('applicant-list');
    if (applicantList) {
      applicantList.innerHTML = `
        <div style="text-align: center; padding: 40px;">
          <i class="fas fa-spinner fa-spin" style="font-size: 24px; color: #666;"></i>
          <p style="margin-top: 16px; color: #666;">위촉자 정보를 불러오는 중...</p>
        </div>
      `;
    }
  }

  /**
   * 에러 표시
   */
  showError(message) {
    const applicantList = document.getElementById('applicant-list');
    if (applicantList) {
      applicantList.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #e74c3c;">
          <i class="fas fa-exclamation-triangle" style="font-size: 24px;"></i>
          <p style="margin-top: 16px;">${message}</p>
        </div>
      `;
    }
  }

  /**
   * 데이터 새로고침
   */
  async refresh() {
    await this.loadApplicants();
  }

  /**
   * 엑셀 다운로드
   */
  async downloadExcel() {
    try {
      // 로딩 상태 표시
      const downloadBtn = document.getElementById('applicant-excel-download');
      if (downloadBtn) {
        downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 다운로드 중...';
        downloadBtn.disabled = true;
      }

      // 현재 표시된 위촉자 목록을 기준으로 다운로드
      const applicantListElement = document.getElementById('applicant-list');
      const displayedCards = applicantListElement.querySelectorAll('.client-card');
      
      // 표시된 카드들의 데이터만 추출
      const displayedApplicants = [];
      displayedCards.forEach(card => {
        const cardHtml = card.outerHTML;
        const onclickMatch = cardHtml.match(/onclick=".*?viewApplicantDetail\('([^']+)'\)"/);
        if (onclickMatch) {
          const applicantId = onclickMatch[1];
          const applicant = this.currentApplicants.find(a => a.id === applicantId);
          if (applicant) {
            displayedApplicants.push(applicant);
          }
        }
      });

      if (displayedApplicants.length === 0) {
        showAlert('다운로드할 위촉자 정보가 없습니다.');
        return;
      }

      // 담당자 정보 로드 (한번에 모든 담당자 정보를 가져옴)
      const managersRef = collection(db, 'managers');
      const managersSnapshot = await getDocs(managersRef);
      const managers = {};
      
      managersSnapshot.forEach((doc) => {
        const manager = doc.data();
        managers[manager.code] = manager;
      });

      // 엑셀 데이터 준비
      const excelData = [];
      
      for (const applicant of displayedApplicants) {
        try {
          // 주민등록번호 복호화
          let decryptedSSN = '';
          try {
            decryptedSSN = await decryptSSN(applicant.ssn);
          } catch (error) {
            console.warn('SSN 복호화 실패:', error);
            decryptedSSN = '복호화 실패';
          }

          // 등록일 포맷팅
          const createdAt = applicant.created_at?.toDate ? applicant.created_at.toDate() : new Date(applicant.created_at);
          const dateStr = createdAt.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          });

          // 시험 정보 파싱
          let examInfo = { examDate: '', region: '', applicationPeriod: '' };
          if (applicant.examId) {
            const examData = this.parseExamIdToData(applicant.examId);
            if (examData) {
              examInfo = {
                examDate: examData.examDate || '',
                region: examData.region || '',
                applicationPeriod: examData.applicationPeriod || ''
              };
            }
          }

          // 담당자 정보
          const managerInfo = managers[applicant.managerCode];
          const managerName = managerInfo?.name || '';
          const gaiaId = managerInfo?.gaiaId || '';

          const row = {
            '등록일': dateStr,
            '이름': applicant.name || '',
            '주민등록번호': decryptedSSN,
            '통신사': applicant.phoneCarrier || '',
            '휴대폰번호': applicant.phone || '',
            '이메일': applicant.email || '',
            '우편번호': applicant.postcode || '',
            '주소': applicant.address || '',
            '상세주소': applicant.addressDetail || '',
            '은행': applicant.bank || '',
            '계좌번호': applicant.accountNumber || '',
            '예금주': applicant.accountHolder || '',
            '최종학력': applicant.education || '',
            '학교명': applicant.schoolName || '',
            '전공': applicant.major || '',
            '경력구분': applicant.experience || '',
            '경력년수': applicant.experienceYears || '',
            '이전회사': applicant.prevCompany || '',
            '시험일': examInfo.examDate,
            '시험지역': examInfo.region,
            '접수마감일': examInfo.applicationPeriod,
            '담당자명': managerName,
            '담당자코드': applicant.managerCode || '',
            '가이아ID': gaiaId
          };

          excelData.push(row);
        } catch (error) {
          console.error('위촉자 데이터 처리 실패:', applicant.id, error);
          // 오류가 발생해도 다른 데이터는 계속 처리
        }
      }

      if (excelData.length === 0) {
        showAlert('엑셀 데이터 생성에 실패했습니다.');
        return;
      }

      // 엑셀 파일 생성
      const worksheet = XLSX.utils.json_to_sheet(excelData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '위촉자 정보');

      // 컬럼 너비 설정
      const colWidths = [
        { wch: 12 }, // 등록일
        { wch: 10 }, // 이름
        { wch: 15 }, // 주민등록번호
        { wch: 10 }, // 통신사
        { wch: 15 }, // 휴대폰번호
        { wch: 25 }, // 이메일
        { wch: 10 }, // 우편번호
        { wch: 30 }, // 주소
        { wch: 20 }, // 상세주소
        { wch: 10 }, // 은행
        { wch: 20 }, // 계좌번호
        { wch: 10 }, // 예금주
        { wch: 12 }, // 최종학력
        { wch: 15 }, // 학교명
        { wch: 15 }, // 전공
        { wch: 10 }, // 경력구분
        { wch: 10 }, // 경력년수
        { wch: 15 }, // 이전회사
        { wch: 12 }, // 시험일
        { wch: 10 }, // 시험지역
        { wch: 20 }, // 접수마감일
        { wch: 10 }, // 담당자명
        { wch: 12 }, // 담당자코드
        { wch: 15 }  // 가이아ID
      ];
      worksheet['!cols'] = colWidths;

      // 파일명 생성
      const now = new Date();
      const timestamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
      const filterInfo = this.getFilterInfo();
      const filename = `위촉자정보_${filterInfo}_${timestamp}.xlsx`;

      // 파일 다운로드
      XLSX.writeFile(workbook, filename);

      showAlert(`${excelData.length}명의 위촉자 정보가 엑셀 파일로 다운로드되었습니다.`);

    } catch (error) {
      console.error('엑셀 다운로드 실패:', error);
      showAlert('엑셀 다운로드 중 오류가 발생했습니다: ' + error.message);
    } finally {
      // 버튼 상태 복원
      const downloadBtn = document.getElementById('applicant-excel-download');
      if (downloadBtn) {
        downloadBtn.innerHTML = '<i class="fas fa-file-excel"></i> 엑셀 다운로드';
        downloadBtn.disabled = false;
      }
    }
  }

  /**
   * 현재 필터 정보 가져오기 (파일명용)
   */
  getFilterInfo() {
    const searchInput = document.getElementById('applicant-search');
    const managerFilter = document.getElementById('manager-filter');
    
    let filterInfo = '전체';
    
    if (managerFilter && managerFilter.value) {
      const selectedOption = managerFilter.querySelector(`option[value="${managerFilter.value}"]`);
      if (selectedOption) {
        filterInfo = selectedOption.textContent.replace(/\s*\(.*\)\s*/, ''); // 담당자 코드 부분 제거
      }
    } else if (this.options.currentManager) {
      filterInfo = this.options.currentManager.name || this.options.currentManager.code;
    }
    
    if (searchInput && searchInput.value.trim()) {
      filterInfo += `_검색(${searchInput.value.trim()})`;
    }
    
    return filterInfo;
  }

  /**
   * 컴포넌트 파괴
   */
  destroy() {
    if (this.container) {
      this.container.innerHTML = '';
    }
    
    // 전역 참조 제거
    if (window.applicantViewer === this) {
      delete window.applicantViewer;
    }
  }
}

/**
 * 편의를 위한 정적 메서드들
 */
ApplicantViewer.createForManager = function(containerId, manager) {
  const viewer = new ApplicantViewer(containerId, {
    showManagerFilter: false,
    currentManager: manager,
    showStats: false
  });
  
  // 전역 참조 등록
  window.applicantViewer = viewer;
  
  return viewer;
};

ApplicantViewer.createForAdmin = function(containerId) {
  const viewer = new ApplicantViewer(containerId, {
    showManagerFilter: true,
    currentManager: null,
    showStats: false,
    searchPlaceholder: '성명, 전화번호, 시험일, 담당자로 검색'
  });
  
  // 전역 참조 등록
  window.applicantViewer = viewer;
  
  return viewer;
};