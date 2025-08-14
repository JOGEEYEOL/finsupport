import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-functions.js";
import { functions } from "../core/firebase-config.js";
import { getLifeInsuranceExamSchedules, crawlLifeInsuranceExamSchedule } from "../services/exam-service.js";

/**
 * 자격시험 일정 UI 컴포넌트
 * 어떤 페이지에서든 import만으로 사용 가능한 재사용 가능한 컴포넌트
 */
export class ExamScheduleUI {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    this.allExamSchedules = [];
    this.selectedRegion = '서울';
    
    // 옵션 설정
    this.options = {
      showCrawlButton: true,
      autoLoad: true,
      defaultRegion: '서울',
      ...options
    };
    
    if (!this.container) {
      throw new Error(`Container with id "${containerId}" not found`);
    }
  }

  /**
   * 컴포넌트 초기화
   */
  initialize() {
    this.selectedRegion = this.options.defaultRegion;
    
    // 창 크기 변경 시 레이아웃 업데이트
    this.setupResponsiveListener();
    
    if (this.options.autoLoad) {
      this.loadExamSchedules();
    } else {
      this.showInitialMessage();
    }
  }

  /**
   * 반응형 리스너 설정
   */
  setupResponsiveListener() {
    // 기존 리스너 제거
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
    }
    
    // 새 리스너 추가
    this.resizeListener = () => {
      if (this.allExamSchedules.length > 0) {
        // 현재 표시된 일정이 있으면 다시 렌더링
        this.displayLifeInsuranceSchedule(this.allExamSchedules);
      }
    };
    
    window.addEventListener('resize', this.resizeListener);
  }

  /**
   * 초기 메시지 표시
   */
  showInitialMessage() {
    this.container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #666;">
        <i class="fas fa-calendar" style="font-size: 48px; margin-bottom: 20px; opacity: 0.5;"></i>
        <p>일정 새로고침 버튼을 눌러서 최신 시험 일정을 확인하세요.</p>
      </div>
    `;
  }

  /**
   * 자격시험 일정 로드
   */
  async loadExamSchedules() {
    try {
      const result = await getLifeInsuranceExamSchedules();
      
      if (result.success) {
        this.displayLifeInsuranceSchedule(result.schedules);
      } else {
        throw new Error(result.error || '자격시험 일정을 불러올 수 없습니다.');
      }
      
    } catch (error) {
      console.error('자격시험 일정 로드 실패:', error);
      this.displayLifeInsuranceError('자격시험 일정을 불러오는데 실패했습니다: ' + error.message);
    }
  }

  /**
   * 크롤링 함수 (전역 함수로도 등록)
   */
  async crawlLifeInsurance() {
    try {
      const crawlBtn = document.getElementById('crawlScheduleBtn');
      if (crawlBtn) {
        crawlBtn.disabled = true;
        crawlBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 크롤링 중...';
      }
      
      const crawlFunction = httpsCallable(functions, 'crawlLifeInsuranceExamSchedule');
      const result = await crawlFunction();
      
      console.log('크롤링 결과:', result);
      
      if (result.data.success) {
        alert(`생명보험 자격시험 일정 ${result.data.schedules.length}개를 성공적으로 업데이트했습니다.`);
        // 일정 다시 로드
        await this.loadExamSchedules();
      } else {
        throw new Error(result.data.message || '크롤링에 실패했습니다.');
      }
      
    } catch (error) {
      console.error('크롤링 실패:', error);
      alert('크롤링에 실패했습니다: ' + error.message);
    } finally {
      const crawlBtn = document.getElementById('crawlScheduleBtn');
      if (crawlBtn) {
        crawlBtn.disabled = false;
        crawlBtn.innerHTML = '<i class="fas fa-sync-alt"></i> 일정 새로고침';
      }
    }
  }

  /**
   * 지역 선택
   */
  selectRegion(region) {
    this.selectedRegion = region;
    
    // 버튼 스타일 업데이트
    document.querySelectorAll('.region-btn').forEach(btn => {
      const isActive = btn.getAttribute('data-region') === region;
      const countSpan = btn.querySelector('span');
      
      if (isActive) {
        btn.style.background = '#667eea';
        btn.style.color = 'white';
        if (countSpan) {
          countSpan.style.background = 'rgba(255,255,255,0.3)';
          countSpan.style.color = 'white';
        }
      } else {
        btn.style.background = 'white';
        btn.style.color = '#667eea';
        if (countSpan) {
          countSpan.style.background = '#f8f9fa';
          countSpan.style.color = '#6c757d';
        }
      }
    });
    
    // 선택된 지역의 일정만 표시
    const schedulesByRegion = {};
    this.allExamSchedules.forEach(schedule => {
      const region = schedule.region || '전국';
      if (!schedulesByRegion[region]) {
        schedulesByRegion[region] = [];
      }
      schedulesByRegion[region].push(schedule);
    });
    
    const container = document.getElementById('scheduleTableContainer');
    if (container) {
      container.innerHTML = this.renderScheduleTable(region, this.allExamSchedules, schedulesByRegion);
    }
  }

  /**
   * 생명보험 자격시험 일정 표시 함수
   */
  displayLifeInsuranceSchedule(schedules) {
    this.allExamSchedules = schedules || [];
    
    if (!schedules || schedules.length === 0) {
      this.container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #666;">
          <i class="fas fa-calendar-times" style="font-size: 48px; margin-bottom: 20px; opacity: 0.5;"></i>
          <p>등록된 시험 일정이 없습니다.</p>
          <p style="font-size: 12px; color: #999;">일정 새로고침 버튼을 눌러서 최신 일정을 가져오세요.</p>
        </div>
      `;
      return;
    }
    
    // 지역별로 그룹화
    const schedulesByRegion = {};
    schedules.forEach(schedule => {
      const region = schedule.region || '전국';
      if (!schedulesByRegion[region]) {
        schedulesByRegion[region] = [];
      }
      schedulesByRegion[region].push(schedule);
    });
    
    // 지역 정렬
    const regionOrder = ['서울', '부산', '인천', '대구', '광주', '대전', '울산', '제주', '강릉', '원주', '춘천', '전주', '서산'];
    const sortedRegions = Object.keys(schedulesByRegion).sort((a, b) => {
      const aIndex = regionOrder.indexOf(a);
      const bIndex = regionOrder.indexOf(b);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.localeCompare(b, 'ko');
    });
    
    // 지역 선택 버튼들 생성
    const regionButtonsHTML = this.createRegionButtons(sortedRegions, schedulesByRegion);
    
    // 초기 선택 지역 설정
    this.selectedRegion = this.options.defaultRegion;
    
    const summaryHTML = `
      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center; border-left: 4px solid #667eea;">
        <h6 style="margin: 0 0 15px 0; color: #2c3e50; font-size: 16px;">
          <i class="fas fa-map-marker-alt"></i> 지역 선택
        </h6>
        ${regionButtonsHTML}
      </div>
    `;
    
    // 일정 테이블 영역
    const scheduleTableHTML = `
      <div id="scheduleTableContainer">
        ${this.renderScheduleTable(this.selectedRegion, schedules, schedulesByRegion)}
      </div>
    `;
    
    this.container.innerHTML = summaryHTML + scheduleTableHTML;
  }

  /**
   * 지역 선택 버튼들 생성 (데스크톱) 또는 셀렉트박스 생성 (모바일)
   */
  createRegionButtons(regions, schedulesByRegion) {
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
      // 모바일에서는 셀렉트박스 사용
      return this.createRegionSelect(regions, schedulesByRegion);
    }
    
    // 데스크톱에서는 기존 버튼들 사용
    let buttonsHTML = '';
    
    regions.forEach(region => {
      const count = schedulesByRegion[region].length;
      const isActive = region === this.selectedRegion;
      
      buttonsHTML += `
        <button 
          class="region-btn ${isActive ? 'active' : ''}" 
          data-region="${region}"
          onclick="window.examScheduleUI.selectRegion('${region}')"
          style="margin: 4px; padding: 8px 16px; border: 2px solid #667eea; background: ${isActive ? '#667eea' : 'white'}; color: ${isActive ? 'white' : '#667eea'}; border-radius: 20px; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.3s ease;">
          ${region} <span style="background: ${isActive ? 'rgba(255,255,255,0.3)' : '#f8f9fa'}; color: ${isActive ? 'white' : '#6c757d'}; padding: 2px 8px; border-radius: 10px; margin-left: 6px;">${count}</span>
        </button>
      `;
    });
    
    return buttonsHTML;
  }

  /**
   * 모바일용 지역 셀렉트박스 생성
   */
  createRegionSelect(regions, schedulesByRegion) {
    let selectHTML = `
      <select 
        id="regionSelect" 
        onchange="window.examScheduleUI.selectRegion(this.value)"
        style="
          width: 100%; 
          padding: 12px 16px; 
          font-size: 16px; 
          font-weight: 500;
          border: 2px solid #667eea; 
          border-radius: 12px; 
          background: white;
          color: #2c3e50;
          appearance: none;
          background-image: url('data:image/svg+xml;charset=US-ASCII,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 4 5\"><path fill=\"%23667eea\" d=\"m0 0 2 2 2-2z\"/></svg>');
          background-repeat: no-repeat;
          background-position: right 12px center;
          background-size: 12px;
          padding-right: 40px;
        "
      >
    `;
    
    regions.forEach(region => {
      const count = schedulesByRegion[region].length;
      const isSelected = region === this.selectedRegion;
      
      selectHTML += `
        <option value="${region}" ${isSelected ? 'selected' : ''}>
          ${region} (${count}건)
        </option>
      `;
    });
    
    selectHTML += '</select>';
    return selectHTML;
  }

  /**
   * 특정 지역의 일정 테이블 렌더링
   */
  renderScheduleTable(region, allSchedules, schedulesByRegion) {
    const regionSchedules = schedulesByRegion[region] || [];
    
    if (regionSchedules.length === 0) {
      return `
        <div style="text-align: center; padding: 40px; color: #666;">
          <i class="fas fa-calendar-times" style="font-size: 48px; margin-bottom: 20px; opacity: 0.5;"></i>
          <p>${region} 지역의 시험 일정이 없습니다.</p>
        </div>
      `;
    }
    
    // 날짜순 정렬
    regionSchedules.sort((a, b) => {
      const dateA = new Date(a.examDate);
      const dateB = new Date(b.examDate);
      return dateA - dateB;
    });
    
    return `
      <div style="margin-bottom: 30px;">
        <h4 style="background: #f8f9fa; padding: 12px 20px; margin: 0 0 16px 0; border-left: 4px solid #3498db; color: #2c3e50; font-weight: 600;">
          ${region} (${regionSchedules.length}건)
        </h4>
        ${this.generateScheduleTable(regionSchedules, region, allSchedules)}
      </div>
    `;
  }

  /**
   * 스케줄 테이블 생성
   */
  generateScheduleTable(schedules, region, allSchedules = []) {
    // 모바일 환경 감지
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
      // 모바일에서는 카드 레이아웃 사용
      return this.generateMobileCardLayout(schedules, region, allSchedules);
    }
    
    // 접수기간별로 그룹화
    const groupedSchedules = this.groupByApplicationPeriod(schedules);
    
    let tableHTML = `
      <div style="overflow-x: auto;">
    `;
    
    Object.keys(groupedSchedules).forEach(applicationPeriod => {
      const groupSchedules = groupedSchedules[applicationPeriod];
      
      // 우리 회사 내부 마감일 계산
      const internalDeadline = this.calculateInternalDeadline(applicationPeriod);
      
      // 접수 가능 여부 판단 (그룹 전체)
      const now = new Date();
      const internalDeadlineDate = this.parseInternalDeadlineDate(applicationPeriod);
      const isGroupExpired = groupSchedules.every(schedule => new Date(schedule.examDate) < now);
      const isGroupDeadlinePassed = internalDeadlineDate && internalDeadlineDate < now;
      
      // 그룹별 버튼은 제거하고 개별 시험일별 버튼만 사용

      tableHTML += `
        <div style="margin-bottom: 24px;">
          <div style="background: #f39c12; color: white; padding: 12px 20px; border-radius: 8px 8px 0 0; font-weight: 600;">
            <div class="exam-header-grid" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
              <div style="font-size: 14px; flex: 1; min-width: 200px;"><i class="fas fa-exclamation-triangle"></i> 사내 접수 마감: ${internalDeadline}</div>
              <div style="background: rgba(255,255,255,0.2); padding: 6px 14px; border-radius: 12px; font-size: 12px; white-space: nowrap; font-weight: 500;">
                <i class="fas fa-calendar-alt"></i> 협회 접수기간: ${applicationPeriod}
              </div>
            </div>
          </div>
          <table style="width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-radius: 0 0 8px 8px; overflow: hidden;">
            <thead>
              <tr style="background: #3498db; color: white;">
                <th style="padding: 12px; text-align: center; font-weight: 600;">시험일</th>
                <th style="padding: 12px; text-align: center; font-weight: 600;">합격자발표</th>
                <th style="padding: 12px; text-align: center; font-weight: 600;">상태</th>
                <th style="padding: 12px; text-align: center; font-weight: 600;">신청</th>
              </tr>
            </thead>
            <tbody>
      `;
      
      groupSchedules.forEach((schedule, index) => {
        const examDate = new Date(schedule.examDate);
        const now = new Date();
        
        // 우리 회사 내부 마감일로 상태 판별
        const internalDeadlineDate = this.parseInternalDeadlineDate(applicationPeriod);
        const isInternalDeadlinePassed = internalDeadlineDate && internalDeadlineDate < now;
        
        const isExpired = examDate < now;
        
        let statusText, statusColor;
        if (isExpired) {
          statusText = '시험완료';
          statusColor = '#95a5a6';
        } else if (isInternalDeadlinePassed) {
          statusText = '접수마감';
          statusColor = '#e74c3c';
        } else {
          statusText = '접수가능';
          statusColor = '#27ae60';
        }
        
        const rowBg = index % 2 === 0 ? '#ffffff' : '#f8f9fa';
        
        // '열기' 텍스트 제거
        const cleanExamDate = (schedule.examDate || '미정').replace(/\s*열기\s*$/, '').trim();
        
        // 차수 판별
        const examRound = this.getExamRound(schedule.examDate, region, allSchedules);
        const examDateWithRound = cleanExamDate + (examRound ? ` (${examRound})` : '');
        
        // 개별 시험일용 examId 생성
        const individualExamId = this.generateExamId(schedule, region);
        
        // 어드민 모드와 담당자 모드에 따라 URL 생성
        let individualApplicantUrl;
        if (this.options.isAdminMode) {
          // 어드민 모드: 시험 정보만 포함 (담당자 코드 없음)
          individualApplicantUrl = `${window.location.origin}/applicant/?exam=${individualExamId}`;
        } else {
          // 담당자 모드: 시험 정보 + 담당자 코드 포함
          const managerCode = window.currentManager?.code || 'UNKNOWN';
          individualApplicantUrl = `${window.location.origin}/applicant/?exam=${individualExamId}&manager=${managerCode}`;
        }
        
        // 개별 신청 버튼 생성
        let individualApplyButton = '';
        if (!isExpired && !isInternalDeadlinePassed) {
          individualApplyButton = `
            <button 
              onclick="copyApplicantLink('${individualApplicantUrl}', '${cleanExamDate}', this)"
              style="
                background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%);
                color: white;
                border: none;
                padding: 6px 12px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                box-shadow: 0 2px 4px rgba(39, 174, 96, 0.2);
              "
              onmouseover="this.style.transform='translateY(-1px)'"
              onmouseout="this.style.transform='translateY(0)'"
            >
              <i class="fas fa-copy"></i> 신청링크
            </button>
          `;
        } else {
          individualApplyButton = `
            <span style="color: #bbb; font-size: 10px;">
              <i class="fas fa-times"></i> 마감
            </span>
          `;
        }
        
        tableHTML += `
          <tr style="background: ${rowBg}; border-bottom: 1px solid #ecf0f1;">
            <td style="padding: 12px; text-align: center; color: #2c3e50; font-weight: 500;">${examDateWithRound}</td>
            <td style="padding: 12px; text-align: center; color: #2c3e50;">${schedule.resultDate || '미정'}</td>
            <td style="padding: 12px; text-align: center;">
              <span style="background: ${statusColor}; color: white; padding: 4px 12px; border-radius: 16px; font-size: 12px; font-weight: 600;">
                ${statusText}
              </span>
            </td>
            <td style="padding: 12px; text-align: center;">
              ${individualApplyButton}
            </td>
          </tr>
        `;
      });
      
      tableHTML += `
            </tbody>
          </table>
        </div>
      `;
    });
    
    tableHTML += '</div>';
    return tableHTML;
  }

  /**
   * 접수기간별로 스케줄 그룹화
   */
  groupByApplicationPeriod(schedules) {
    const grouped = {};
    
    schedules.forEach(schedule => {
      const period = schedule.applicationPeriod || '미정';
      if (!grouped[period]) {
        grouped[period] = [];
      }
      grouped[period].push(schedule);
    });
    
    // 각 그룹 내에서 시험일순으로 정렬
    Object.keys(grouped).forEach(period => {
      grouped[period].sort((a, b) => {
        const dateA = new Date(a.examDate);
        const dateB = new Date(b.examDate);
        return dateA - dateB;
      });
    });
    
    return grouped;
  }

  /**
   * 우리 회사 내부 마감일 계산 (협회 접수 시작일 전날 오전 11시)
   */
  calculateInternalDeadline(applicationPeriod) {
    if (!applicationPeriod || applicationPeriod === '미정') {
      return '미정';
    }
    
    try {
      // "YYYY-MM-DD(요일) HH:MM ~ YYYY-MM-DD(요일) HH:MM" 형식에서 시작일 추출
      const startDateMatch = applicationPeriod.match(/(\d{4}-\d{2}-\d{2})/);
      if (!startDateMatch) {
        return '미정';
      }
      
      const startDate = new Date(startDateMatch[1]);
      if (isNaN(startDate.getTime())) {
        return '미정';
      }
      
      // 하루 전으로 설정
      const internalDate = new Date(startDate);
      internalDate.setDate(internalDate.getDate() - 1);
      
      // 요일 한국어로 변환
      const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
      const dayName = dayNames[internalDate.getDay()];
      
      const year = internalDate.getFullYear();
      const month = String(internalDate.getMonth() + 1).padStart(2, '0');
      const day = String(internalDate.getDate()).padStart(2, '0');
      
      return `${year}-${month}-${day}(${dayName}) 11:00`;
    } catch (error) {
      console.warn('내부 마감일 계산 실패:', applicationPeriod, error);
      return '미정';
    }
  }

  /**
   * 내부 마감일을 Date 객체로 파싱
   */
  parseInternalDeadlineDate(applicationPeriod) {
    if (!applicationPeriod || applicationPeriod === '미정') {
      return null;
    }
    
    try {
      const startDateMatch = applicationPeriod.match(/(\d{4}-\d{2}-\d{2})/);
      if (!startDateMatch) {
        return null;
      }
      
      const startDate = new Date(startDateMatch[1]);
      if (isNaN(startDate.getTime())) {
        return null;
      }
      
      // 하루 전 오전 11시로 설정
      const internalDate = new Date(startDate);
      internalDate.setDate(internalDate.getDate() - 1);
      internalDate.setHours(11, 0, 0, 0);
      
      return internalDate;
    } catch (error) {
      console.warn('내부 마감일 파싱 실패:', applicationPeriod, error);
      return null;
    }
  }

  /**
   * 모바일용 카드 레이아웃 생성
   */
  generateMobileCardLayout(schedules, region, allSchedules = []) {
    // 접수기간별로 그룹화
    const groupedSchedules = this.groupByApplicationPeriod(schedules);
    
    let cardHTML = '<div style="display: flex; flex-direction: column; gap: 16px;">';
    
    Object.keys(groupedSchedules).forEach(applicationPeriod => {
      const groupSchedules = groupedSchedules[applicationPeriod];
      
      // 우리 회사 내부 마감일 계산
      const internalDeadline = this.calculateInternalDeadline(applicationPeriod);
      
      // 접수 가능 여부 판단 (그룹 전체) - 모바일용
      const now = new Date();
      const internalDeadlineDate = this.parseInternalDeadlineDate(applicationPeriod);
      const isGroupExpired = groupSchedules.every(schedule => new Date(schedule.examDate) < now);
      const isGroupDeadlinePassed = internalDeadlineDate && internalDeadlineDate < now;
      
      // 모바일에서도 개별 시험일별 버튼만 사용
      
      cardHTML += `
        <div style="margin-bottom: 20px;">
          <div style="background: #f39c12; color: white; padding: 12px 16px; border-radius: 12px 12px 0 0; font-weight: 600; font-size: 14px;">
            <div style="margin-bottom: 8px;"><i class="fas fa-exclamation-triangle"></i> 사내 접수 마감: ${internalDeadline}</div>
            <div style="background: rgba(255,255,255,0.2); padding: 6px 10px; border-radius: 8px; font-size: 12px;">
              <i class="fas fa-calendar-alt"></i> 협회 접수기간: ${applicationPeriod}
            </div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px; padding: 4px; background: #f8f9fa; border-radius: 0 0 12px 12px;">
      `;
      
      groupSchedules.forEach(schedule => {
        const examDate = new Date(schedule.examDate);
        const now = new Date();
        
        // 우리 회사 내부 마감일로 상태 판별
        const internalDeadlineDate = this.parseInternalDeadlineDate(applicationPeriod);
        const isInternalDeadlinePassed = internalDeadlineDate && internalDeadlineDate < now;
        
        const isExpired = examDate < now;
        
        let statusText, statusColor;
        if (isExpired) {
          statusText = '시험완료';
          statusColor = '#95a5a6';
        } else if (isInternalDeadlinePassed) {
          statusText = '접수마감';
          statusColor = '#e74c3c';
        } else {
          statusText = '접수가능';
          statusColor = '#27ae60';
        }
        
        // '열기' 텍스트 제거
        const cleanExamDate = (schedule.examDate || '미정').replace(/\s*열기\s*$/, '').trim();
        
        // 차수 판별 (모바일용)
        const mobileExamRound = this.getExamRound(schedule.examDate, region, allSchedules);
        const mobileExamDateWithRound = cleanExamDate + (mobileExamRound ? ` (${mobileExamRound})` : '');
        
        // 모바일용 개별 버튼 생성
        const mobileIndividualExamId = this.generateExamId(schedule, region);
        
        // 어드민 모드와 담당자 모드에 따라 모바일 URL 생성
        let mobileIndividualApplicantUrl;
        if (this.options.isAdminMode) {
          // 어드민 모드: 시험 정보만 포함 (담당자 코드 없음)
          mobileIndividualApplicantUrl = `${window.location.origin}/applicant/?exam=${mobileIndividualExamId}`;
        } else {
          // 담당자 모드: 시험 정보 + 담당자 코드 포함
          const mobileManagerCode = window.currentManager?.code || 'UNKNOWN';
          mobileIndividualApplicantUrl = `${window.location.origin}/applicant/?exam=${mobileIndividualExamId}&manager=${mobileManagerCode}`;
        }
        
        let mobileIndividualApplyButton = '';
        if (!isExpired && !isInternalDeadlinePassed) {
          mobileIndividualApplyButton = `
            <button 
              onclick="copyApplicantLink('${mobileIndividualApplicantUrl}', '${cleanExamDate}', this)"
              style="
                background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%);
                color: white;
                border: none;
                padding: 8px 12px;
                border-radius: 8px;
                font-size: 11px;
                font-weight: 600;
                cursor: pointer;
                width: 100%;
                margin-top: 8px;
                transition: all 0.3s ease;
                box-shadow: 0 2px 4px rgba(39, 174, 96, 0.2);
              "
            >
              <i class="fas fa-copy"></i> 링크복사
            </button>
          `;
        } else {
          mobileIndividualApplyButton = `
            <div style="text-align: center; margin-top: 8px; color: #bbb; font-size: 10px;">
              <i class="fas fa-times"></i> 마감
            </div>
          `;
        }
        
        cardHTML += `
          <div style="background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.08);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-weight: 600; color: #2c3e50; font-size: 15px;"><i class="fas fa-calendar-day"></i> ${mobileExamDateWithRound}</span>
              <span style="background: ${statusColor}; color: white; padding: 3px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;">
                ${statusText}
              </span>
            </div>
            
            <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
              <i class="fas fa-trophy" style="width: 14px;"></i> 합격자발표: <span style="color: #2c3e50;">${schedule.resultDate || '미정'}</span>
            </div>
            ${mobileIndividualApplyButton}
          </div>
        `;
      });
      
      cardHTML += `
          </div>
        </div>
      `;
    });
    
    cardHTML += '</div>';
    return cardHTML;
  }

  /**
   * 에러 메시지 표시
   */
  displayLifeInsuranceError(message) {
    this.container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #e74c3c;">
        <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 20px; opacity: 0.5;"></i>
        <p>${message}</p>
      </div>
    `;
  }

  /**
   * 시험 고유 ID 생성
   */
  generateExamId(schedule, region) {
    // 시험일에서 날짜 부분만 추출
    const cleanExamDate = (schedule.examDate || '미정').replace(/\s*열기\s*$/, '').trim();
    const dateMatch = cleanExamDate.match(/(\d{4}-\d{2}-\d{2})/);
    const dateStr = dateMatch ? dateMatch[1] : cleanExamDate.replace(/[^\d-]/g, '');
    
    // 지역 코드 생성
    const regionCode = this.getRegionCode(region);
    
    // 접수기간에서 시작일 추출
    const applicationMatch = schedule.applicationPeriod?.match(/(\d{4}-\d{2}-\d{2})/);
    const applicationStr = applicationMatch ? applicationMatch[1] : '';
    
    // ID 생성: YYYYMMDD_REGION_APPLICATION
    const examId = `${dateStr.replace(/-/g, '')}_${regionCode}_${applicationStr.replace(/-/g, '')}`;
    
    return examId;
  }
  
  /**
   * 지역 코드 생성
   */
  getRegionCode(region) {
    const regionCodes = {
      '서울': 'SEL',
      '부산': 'PUS', 
      '인천': 'ICN',
      '대구': 'DAE',
      '광주': 'GWJ',
      '대전': 'DJN',
      '울산': 'ULS',
      '제주': 'JEJ',
      '강릉': 'KRL',
      '원주': 'WON',
      '춘천': 'CCN',
      '전주': 'JEO',
      '서산': 'SRS',
      '전국': 'ALL'
    };
    
    return regionCodes[region] || 'ETC';
  }

  /**
   * 시험일로부터 차수 판별 (지역별 월별 시험일 순서에 따라)
   */
  getExamRound(examDateStr, region, allSchedules) {
    if (!examDateStr || !region || !allSchedules) return '';
    
    try {
      // '열기' 텍스트 제거하고 날짜 추출
      const cleanExamDate = examDateStr.replace(/\s*열기\s*$/, '').trim();
      const dateMatch = cleanExamDate.match(/(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) return '';
      
      const targetExamDate = dateMatch[1];
      const examDate = new Date(targetExamDate);
      if (isNaN(examDate.getTime())) return '';
      
      const year = examDate.getFullYear();
      const month = examDate.getMonth() + 1;
      
      // 같은 지역, 같은 년월의 시험일들을 수집
      const sameMonthExams = [];
      allSchedules.forEach(schedule => {
        if (schedule.region === region) {
          const scheduleCleanDate = (schedule.examDate || '').replace(/\s*열기\s*$/, '').trim();
          const scheduleMatch = scheduleCleanDate.match(/(\d{4}-\d{2}-\d{2})/);
          if (scheduleMatch) {
            const scheduleExamDate = new Date(scheduleMatch[1]);
            if (!isNaN(scheduleExamDate.getTime()) && 
                scheduleExamDate.getFullYear() === year && 
                scheduleExamDate.getMonth() + 1 === month) {
              sameMonthExams.push(scheduleMatch[1]);
            }
          }
        }
      });
      
      // 중복 제거 및 날짜 순 정렬
      const uniqueExamDates = [...new Set(sameMonthExams)].sort();
      
      // 현재 시험일의 순서 찾기
      const examIndex = uniqueExamDates.indexOf(targetExamDate);
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
   * 컴포넌트 파괴 (필요시 사용)
   */
  destroy() {
    if (this.container) {
      this.container.innerHTML = '';
    }
    
    // 리사이즈 리스너 제거
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
      this.resizeListener = null;
    }
    
    // 전역 참조 제거
    if (window.examScheduleUI === this) {
      delete window.examScheduleUI;
    }
    if (window.crawlLifeInsuranceSchedule) {
      delete window.crawlLifeInsuranceSchedule;
    }
  }
}

/**
 * 편의를 위한 정적 메서드들
 */
ExamScheduleUI.createWithCrawlButton = function(containerId, options = {}) {
  const ui = new ExamScheduleUI(containerId, {
    showCrawlButton: true,
    ...options
  });
  
  // 전역 참조 등록 (크롤링 버튼에서 사용)
  window.examScheduleUI = ui;
  window.crawlLifeInsuranceSchedule = () => ui.crawlLifeInsurance();
  
  return ui;
};

ExamScheduleUI.createSimple = function(containerId, options = {}) {
  return new ExamScheduleUI(containerId, {
    showCrawlButton: false,
    ...options
  });
};