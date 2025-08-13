import { db, functions } from "/common/js/core/firebase-config.js";
import { collection, addDoc, getDocs, query, where, Timestamp } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-functions.js";

// URL 파라미터 파싱
function getUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  return {
    examId: urlParams.get('exam'),
    managerCode: urlParams.get('manager')
  };
}

// 합성 시험 ID에서 시험 정보 추출
function parseExamIdToData(examId) {
  try {
    // examId 형식: YYYYMMDD_REGION_YYYYMMDD (예: 20241215_SEL_20241201)
    const parts = examId.split('_');
    if (parts.length !== 3) {
      return null;
    }
    
    const [examDateStr, regionCode, applicationDateStr] = parts;
    
    // 날짜 형식 변환
    const examDate = formatDateFromString(examDateStr);
    const applicationDate = formatDateFromString(applicationDateStr);
    
    // 지역 코드 변환
    const region = getRegionFromCode(regionCode);
    
    if (!examDate || !region) {
      return null;
    }
    
    // 사내 마감일 계산 (협회 접수 시작일 전날 오전 11시)
    const internalDeadline = calculateInternalDeadline(applicationDate);
    
    // 모의 시험 데이터 생성
    return {
      id: examId,
      examDate: examDate,
      region: region,
      applicationPeriod: internalDeadline, // 사내 마감일로 변경
      resultDate: '미정',
      type: 'life_insurance'
    };
  } catch (error) {
    console.error('시험 ID 파싱 실패:', examId, error);
    return null;
  }
}

// 날짜 문자열을 포맷팅 (YYYYMMDD -> YYYY-MM-DD)
function formatDateFromString(dateStr) {
  if (!dateStr || dateStr.length !== 8) {
    return null;
  }
  
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);
  
  return `${year}-${month}-${day}`;
}

// 지역 코드에서 지역명 변환
function getRegionFromCode(regionCode) {
  const regionMap = {
    'SEL': '서울',
    'PUS': '부산', 
    'ICN': '인천',
    'DAE': '대구',
    'GWJ': '광주',
    'DJN': '대전',
    'ULS': '울산',
    'JEJ': '제주',
    'KRL': '강릉',
    'WON': '원주',
    'CCN': '춘천',
    'JEO': '전주',
    'SRS': '서산',
    'ALL': '전국',
    'ETC': '기타'
  };
  
  return regionMap[regionCode] || null;
}

// 사내 마감일 계산 (협회 접수 시작일 전날 오전 11시)
function calculateInternalDeadline(applicationStartDate) {
  try {
    const startDate = new Date(applicationStartDate);
    if (isNaN(startDate.getTime())) {
      return `${applicationStartDate} 전날 11:00까지`;
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
    
    return `${year}-${month}-${day}(${dayName}) 11:00까지`;
  } catch (error) {
    return `${applicationStartDate} 전날 11:00까지`;
  }
}

// 시험 정보 로드 및 표시
async function loadExamInfo() {
  const { examId, managerCode } = getUrlParams();
  
  // 파라미터가 없는 경우 (일반 지원자) - 기본 정보 표시
  if (!examId && !managerCode) {
    displayDefaultInfo();
    return true;
  }
  
  // examId가 없는 경우 에러
  if (!examId) {
    showError('시험 정보가 없습니다. 링크를 다시 확인해주세요.');
    return false;
  }
  
  // managerCode가 없는 경우는 어드민에서 생성된 링크이므로 허용
  
  try {
    let examData;
    
    // 시험 정보 조회
    const examQuery = query(collection(db, 'exam_schedules'), where('id', '==', examId));
    const examSnapshot = await getDocs(examQuery);
    
    if (examSnapshot.empty) {
      // 데이터베이스에서 찾을 수 없는 경우, 합성 ID에서 정보 추출
      examData = parseExamIdToData(examId);
      if (!examData) {
        showError('시험 정보를 찾을 수 없습니다.');
        return false;
      }
    } else {
      examData = examSnapshot.docs[0].data();
    }
    
    let managerData = null;
    
    // 담당자 정보 조회 (managerCode가 있는 경우만)
    if (managerCode) {
      const managerQuery = query(collection(db, 'managers'), where('code', '==', managerCode));
      const managerSnapshot = await getDocs(managerQuery);
      
      if (managerSnapshot.empty) {
        showError('담당자 정보를 찾을 수 없습니다.');
        return false;
      }
      
      managerData = managerSnapshot.docs[0].data();
    }
    
    // 시험 정보 표시
    displayExamInfo(examData, managerData);
    
    // 히든 필드에 값 설정
    document.getElementById('examId').value = examId;
    document.getElementById('managerCode').value = managerCode || '';
    
    return true;
  } catch (error) {
    console.error('시험 정보 로드 실패:', error);
    showError('시험 정보를 불러오는 중 오류가 발생했습니다.');
    return false;
  }
}

// 기본 정보 표시 (파라미터 없이 접근한 경우)
function displayDefaultInfo() {
  const examDetails = document.getElementById('exam-details');
  if (!examDetails) return;
  
  examDetails.innerHTML = '';
  
  // 상태바 초기화 (1단계로 리셋)
  resetProgressBar();
}

// 상태바를 1단계로 초기화
function resetProgressBar() {
  // 현재 단계를 1로 설정
  const currentStepSpan = document.getElementById('current-step');
  if (currentStepSpan) {
    currentStepSpan.textContent = '1';
  }
  
  // 진행률 바 초기화 (1/7 = 약 14.3%)
  const progressFill = document.getElementById('progress-fill');
  if (progressFill) {
    progressFill.style.width = '14.3%';
  }
  
  // 모든 스텝 라벨을 비활성화하고 첫 번째만 활성화
  document.querySelectorAll('.step-label').forEach(label => {
    label.classList.remove('active');
  });
  
  const firstStepLabel = document.querySelector('.step-label[data-step="1"]');
  if (firstStepLabel) {
    firstStepLabel.classList.add('active');
  }
}

// 시험 정보 표시 (담당자 연결된 경우)
function displayExamInfo(examData, managerData) {
  const examDetails = document.getElementById('exam-details');
  if (!examDetails) return;
  
  examDetails.innerHTML = `
    <div class="exam-item">
      <i class="fas fa-book"></i>
      <span><strong>시험명:</strong> ${examData.examName || '생명보험자격시험'}${examData.region ? `(${examData.region})` : ''}</span>
    </div>
    <div class="exam-item">
      <i class="fas fa-calendar"></i>
      <span><strong>시험일:</strong> ${examData.examDate || ''}</span>
    </div>
    <div class="exam-item">
      <i class="fas fa-clock"></i>
      <span><strong>접수기간:</strong> ${examData.applicationPeriod || ''}</span>
    </div>
    ${managerData ? `
    <div class="exam-item">
      <i class="fas fa-user-tie"></i>
      <span><strong>담당자:</strong> ${managerData.name || ''} (${managerData.team || ''})</span>
    </div>` : `
    <div class="exam-item">
      <i class="fas fa-globe"></i>
      <span><strong>신청방식:</strong> 관리자 링크를 통한 직접 신청</span>
    </div>`}
  `;
}

// 에러 메시지 표시
function showError(message) {
  const container = document.querySelector('.container');
  container.innerHTML = `
    <div class="error-container" style="text-align: center; padding: 40px; color: #e74c3c;">
      <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 20px;"></i>
      <h3>오류가 발생했습니다</h3>
      <p>${message}</p>
      <button onclick="history.back()" style="margin-top: 20px; padding: 10px 20px; background: #3498db; color: white; border: none; border-radius: 5px; cursor: pointer;">
        이전으로 돌아가기
      </button>
    </div>
  `;
}

// 다음 필드로 자동 이동 (주민번호)
function setupAutoMove() {
  const ssnFront = document.getElementById('ssnFront');
  const ssnBack = document.getElementById('ssnBack');
  
  if (ssnFront && ssnBack) {
    ssnFront.addEventListener('input', function(e) {
      e.target.value = e.target.value.replace(/[^0-9]/g, '');
      if (e.target.value.length >= 6) {
        ssnBack.focus();
      }
    });
    
    ssnBack.addEventListener('input', function(e) {
      e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });
    
    ssnBack.addEventListener('keydown', function(e) {
      if (e.key === 'Backspace' && e.target.value === '') {
        ssnFront.focus();
        ssnFront.setSelectionRange(ssnFront.value.length, ssnFront.value.length);
      }
    });
  }
}

// 전화번호 포맷팅
function setupPhoneFormatting() {
  const phoneInput = document.getElementById('phone');
  if (phoneInput) {
    phoneInput.addEventListener('input', function(e) {
      let value = e.target.value.replace(/[^0-9]/g, '');
      
      if (value.length <= 3) {
        e.target.value = value;
      } else if (value.length <= 7) {
        e.target.value = value.slice(0, 3) + '-' + value.slice(3);
      } else {
        e.target.value = value.slice(0, 3) + '-' + value.slice(3, 7) + '-' + value.slice(7, 11);
      }
    });
  }
}

// 계좌번호 숫자만 입력
function setupAccountNumberFormatting() {
  const accountInput = document.getElementById('accountNumber');
  if (accountInput) {
    accountInput.addEventListener('input', function(e) {
      e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });
  }
}

// 경력 구분 선택 시 추가 필드 표시
function setupExperienceFields() {
  const experienceRadios = document.querySelectorAll('input[name="experience"]');
  const experienceDetail = document.getElementById('experienceDetail');
  const previousCompany = document.getElementById('previousCompany');
  
  experienceRadios.forEach(radio => {
    radio.addEventListener('change', function() {
      if (this.value === '경력') {
        experienceDetail.style.display = 'block';
        previousCompany.style.display = 'block';
      } else {
        experienceDetail.style.display = 'none';
        previousCompany.style.display = 'none';
        // 값 초기화
        document.getElementById('experienceYears').value = '';
        document.getElementById('prevCompany').value = '';
      }
    });
  });
}

// 개인정보 동의 체크박스
function setupConsentCheckbox() {
  window.toggleConsent = function(checkboxId) {
    const checkbox = document.getElementById(checkboxId);
    const icon = document.getElementById(checkboxId + '-icon');
    
    checkbox.checked = !checkbox.checked;
    
    if (checkbox.checked) {
      icon.classList.add('checked');
    } else {
      icon.classList.remove('checked');
    }
    
    // 동의 상태에 따라 제출 버튼 활성화/비활성화
    updateSubmitButton();
  };
}

// 제출 버튼 활성화/비활성화 함수
function updateSubmitButton() {
  const agree1 = document.getElementById('agree1').checked;
  const agree2 = document.getElementById('agree2').checked;
  const submitBtn = document.getElementById('submit-btn');
  
  if (submitBtn) {
    if (agree1 && agree2) {
      submitBtn.disabled = false;
      submitBtn.classList.add('active');
    } else {
      submitBtn.disabled = true;
      submitBtn.classList.remove('active');
    }
  }
}

// 모달 관리
function setupModals() {
  window.openModal = function(modalId) {
    document.getElementById(modalId).style.display = 'block';
  };
  
  window.closeModal = function(modalId) {
    document.getElementById(modalId).style.display = 'none';
  };
  
  // 모달 외부 클릭 시 닫기
  window.addEventListener('click', function(event) {
    if (event.target.classList.contains('modal')) {
      event.target.style.display = 'none';
    }
  });
}

// 주소 검색 (Daum Postcode API)
window.execDaumPostcode = function() {
  new daum.Postcode({
    oncomplete: function(data) {
      document.getElementById('postcode').value = data.zonecode;
      document.getElementById('address').value = data.address;
      document.getElementById('addressDetail').focus();
    }
  }).open();
};

// 폼 검증
function validateForm() {
  const errors = [];
  
  // 필수 필드 검증
  const requiredFields = [
    { id: 'name', message: '성함을 입력해주세요.' },
    { id: 'ssnFront', message: '주민등록번호 앞자리를 입력해주세요.' },
    { id: 'ssnBack', message: '주민등록번호 뒷자리를 입력해주세요.' },
    { id: 'email', message: '이메일 주소를 입력해주세요.' },
    { id: 'phoneCarrier', message: '통신사를 선택해주세요.' },
    { id: 'phone', message: '핸드폰번호를 입력해주세요.' },
    { id: 'postcode', message: '주소를 검색해주세요.' },
    { id: 'addressDetail', message: '상세주소를 입력해주세요.' },
    { id: 'bank', message: '은행을 선택해주세요.' },
    { id: 'accountNumber', message: '계좌번호를 입력해주세요.' },
    { id: 'accountHolder', message: '예금주를 입력해주세요.' },
    { id: 'education', message: '최종 학력을 선택해주세요.' }
  ];
  
  requiredFields.forEach(field => {
    const element = document.getElementById(field.id);
    const errorElement = document.getElementById(field.id.replace(/([A-Z])/g, '-$1').toLowerCase() + '-error') || 
                        document.getElementById(field.id + '-error');
    
    if (!element.value.trim()) {
      errors.push(field.message);
      element.classList.add('error');
      if (errorElement) {
        errorElement.textContent = field.message;
        errorElement.classList.add('show');
      }
    } else {
      element.classList.remove('error');
      if (errorElement) {
        errorElement.classList.remove('show');
      }
    }
  });
  
  // 경력 구분 검증
  const experienceChecked = document.querySelector('input[name="experience"]:checked');
  const experienceError = document.getElementById('experience-error');
  
  if (!experienceChecked) {
    errors.push('경력 구분을 선택해주세요.');
    if (experienceError) {
      experienceError.classList.add('show');
    }
  } else {
    if (experienceError) {
      experienceError.classList.remove('show');
    }
  }
  
  // 주민번호 길이 검증
  const ssnFront = document.getElementById('ssnFront').value;
  const ssnBack = document.getElementById('ssnBack').value;
  const ssnError = document.getElementById('ssn-error');
  
  if (ssnFront.length !== 6 || ssnBack.length !== 7) {
    errors.push('주민등록번호를 정확히 입력해주세요.');
    document.getElementById('ssnFront').classList.add('error');
    document.getElementById('ssnBack').classList.add('error');
    if (ssnError) {
      ssnError.classList.add('show');
    }
  } else {
    document.getElementById('ssnFront').classList.remove('error');
    document.getElementById('ssnBack').classList.remove('error');
    if (ssnError) {
      ssnError.classList.remove('show');
    }
  }
  
  // 이메일 형식 검증
  const email = document.getElementById('email').value;
  const emailError = document.getElementById('email-error');
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (email && !emailRegex.test(email)) {
    errors.push('올바른 이메일 형식을 입력해주세요.');
    document.getElementById('email').classList.add('error');
    if (emailError) {
      emailError.textContent = '올바른 이메일 형식을 입력해주세요.';
      emailError.classList.add('show');
    }
  }
  
  // 개인정보 동의 검증
  const agree1 = document.getElementById('agree1');
  const agree1Error = document.getElementById('agree1-error');
  
  if (!agree1.checked) {
    errors.push('개인정보 수집 및 이용에 동의해주세요.');
    if (agree1Error) {
      agree1Error.classList.add('show');
    }
  } else {
    if (agree1Error) {
      agree1Error.classList.remove('show');
    }
  }
  
  // 제3자 정보 제공 동의 검증
  const agree2 = document.getElementById('agree2');
  const agree2Error = document.getElementById('agree2-error');
  
  if (!agree2.checked) {
    errors.push('개인정보 제3자 제공에 동의해주세요.');
    if (agree2Error) {
      agree2Error.classList.add('show');
    }
  } else {
    if (agree2Error) {
      agree2Error.classList.remove('show');
    }
  }
  
  return errors.length === 0;
}

// 폼 제출 (중복 체크는 2단계에서 이미 완료됨)
async function submitForm(formData) {
  try {
    // 바로 저장 진행 (중복 체크는 2단계에서 이미 수행)
    const saveApplicantInfoFunction = httpsCallable(functions, 'saveApplicantInfo');
    await saveApplicantInfoFunction(formData);
    
    console.log('위촉자 정보 저장 완료!');
    
    // 성공 메시지 표시
    showSuccessMessage();
    
  } catch (error) {
    console.error('위촉자 정보 저장 실패:', error);
    alert('정보 저장 중 오류가 발생했습니다. 다시 시도해주세요.');
    
    // 제출 버튼 복원
    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 제출하기';
    }
  }
}

// 성공 메시지 표시
function showSuccessMessage() {
  const container = document.querySelector('.container');
  container.innerHTML = `
    <div style="text-align: center; padding: 40px;">
      <i class="fas fa-check-circle" style="font-size: 64px; color: #27ae60; margin-bottom: 20px;"></i>
      <h2 style="color: #27ae60; margin-bottom: 20px;">신청이 완료되었습니다!</h2>
      <p style="font-size: 16px; color: #666; line-height: 1.6; margin-bottom: 30px;">
        위촉자 정보가 성공적으로 등록되었습니다.<br>
        담당자가 검토 후 연락드리겠습니다.
      </p>
      <p style="font-size: 14px; color: #999;">
        문의사항이 있으시면 담당자에게 연락해주세요.
      </p>
    </div>
  `;
}

// 단계별 폼 관리
let currentStep = 1;
const totalSteps = 7;

// 단계 이동 함수
async function goToStep(step) {
  if (step < 1 || step > totalSteps) return;
  
  // 2단계에서 3단계로 이동할 때 중복 체크 실행
  if (currentStep === 2 && step === 3) {
    const duplicateCheckResult = await performDuplicateCheck();
    if (!duplicateCheckResult) {
      return; // 중복된 경우 다음 단계로 이동하지 않음
    }
  }
  
  // 현재 단계 숨기기
  const currentSection = document.querySelector(`.step-section[data-step="${currentStep}"]`);
  if (currentSection) {
    currentSection.classList.remove('active');
  }
  
  // 새 단계 보이기
  const newSection = document.querySelector(`.step-section[data-step="${step}"]`);
  if (newSection) {
    newSection.classList.add('active');
  }
  
  // 현재 단계 업데이트
  currentStep = step;
  
  // 6단계로 이동할 때 요약 정보 생성
  if (step === 6) {
    generateSummary();
  }
  
  // UI 업데이트
  updateProgressBar();
  updateStepLabels();
  updateNavigationButtons();
  
  // 스크롤을 최상단으로
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 진행률 바 업데이트
function updateProgressBar() {
  const progressFill = document.getElementById('progress-fill');
  const currentStepSpan = document.getElementById('current-step');
  
  if (progressFill) {
    const progress = (currentStep / totalSteps) * 100;
    progressFill.style.width = `${progress}%`;
  }
  
  if (currentStepSpan) {
    currentStepSpan.textContent = currentStep;
  }
}

// 단계 라벨 업데이트
function updateStepLabels() {
  const stepLabels = document.querySelectorAll('.step-label');
  const totalStepsElement = document.getElementById('total-steps');
  
  // total-steps 요소 업데이트
  if (totalStepsElement) {
    totalStepsElement.textContent = totalSteps;
  }
  
  stepLabels.forEach((label, index) => {
    const stepNumber = index + 1;
    label.classList.remove('active', 'completed');
    
    if (stepNumber === currentStep) {
      label.classList.add('active');
    } else if (stepNumber < currentStep) {
      label.classList.add('completed');
    }
  });
}

// 네비게이션 버튼 업데이트
function updateNavigationButtons() {
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const submitBtn = document.getElementById('submit-btn');
  
  // 이전 버튼
  if (prevBtn) {
    if (currentStep === 1) {
      prevBtn.style.display = 'none';
    } else {
      prevBtn.style.display = 'flex';
    }
  }
  
  // 다음 버튼
  if (nextBtn) {
    if (currentStep === totalSteps) {
      nextBtn.style.display = 'none';
    } else {
      nextBtn.style.display = 'flex';
      // 현재 단계의 검증 상태에 따라 활성화/비활성화
      nextBtn.disabled = !validateCurrentStep();
    }
  }
  
  // 제출 버튼 (7단계에서만 표시)
  if (submitBtn) {
    if (currentStep === totalSteps) {
      submitBtn.style.display = 'flex';
      // 동의 상태에 따라 활성화/비활성화
      updateSubmitButton();
    } else {
      submitBtn.style.display = 'none';
    }
  }
}

// 현재 단계 검증
function validateCurrentStep() {
  switch (currentStep) {
    case 1: // 기본 정보
      const name = document.getElementById('name').value.trim();
      const ssnFront = document.getElementById('ssnFront').value;
      const ssnBack = document.getElementById('ssnBack').value;
      return name && ssnFront.length === 6 && ssnBack.length === 7;
      
    case 2: // 연락처 정보
      const phoneCarrier = document.getElementById('phoneCarrier').value;
      const phone = document.getElementById('phone').value.trim();
      const email = document.getElementById('email').value.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return phoneCarrier && phone && email && emailRegex.test(email);
      
    case 3: // 주소 정보
      const postcode = document.getElementById('postcode').value;
      const addressDetail = document.getElementById('addressDetail').value.trim();
      return postcode && addressDetail;
      
    case 4: // 계좌 정보
      const bank = document.getElementById('bank').value;
      const accountNumber = document.getElementById('accountNumber').value.trim();
      const accountHolder = document.getElementById('accountHolder').value.trim();
      return bank && accountNumber && accountHolder;
      
    case 5: // 학력 및 경력
      const education = document.getElementById('education').value;
      const experience = document.querySelector('input[name="experience"]:checked');
      return education && experience;
      
    case 6: // 입력 정보 확인 (요약)
      return true; // 요약 단계는 검증 불필요
      
    case 7: // 동의 및 제출
      const agree1 = document.getElementById('agree1').checked;
      const agree2 = document.getElementById('agree2').checked;
      return agree1 && agree2;
      
    default:
      return false;
  }
}

// 중복 체크 수행 (2단계에서 실행)
async function performDuplicateCheck() {
  try {
    // 로딩 상태 표시
    const nextBtn = document.getElementById('next-btn');
    const originalText = nextBtn.innerHTML;
    nextBtn.disabled = true;
    nextBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 확인중...';
    
    // 현재 입력된 정보 수집
    const name = document.getElementById('name').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const email = document.getElementById('email').value.trim();
    
    // Firebase Functions 호출
    const checkDuplicateFunction = httpsCallable(functions, 'checkApplicantDuplicate');
    const duplicateResult = await checkDuplicateFunction({
      name: name,
      phone: phone,
      email: email
    });
    
    // 버튼 원상 복구
    nextBtn.disabled = false;
    nextBtn.innerHTML = originalText;
    
    // 중복된 정보가 있는 경우
    if (duplicateResult.data.isDuplicate) {
      alert(duplicateResult.data.message);
      return false; // 다음 단계로 이동하지 않음
    }
    
    // 중복되지 않은 경우
    return true; // 다음 단계로 이동 허용
    
  } catch (error) {
    console.error('중복 체크 실패:', error);
    
    // 버튼 원상 복구
    const nextBtn = document.getElementById('next-btn');
    nextBtn.disabled = false;
    nextBtn.innerHTML = '다음 <i class="fas fa-chevron-right"></i>';
    
    // 에러가 발생한 경우에도 다음 단계로 진행 허용 (서비스 중단 방지)
    const continueAnyway = confirm('중복 확인 중 오류가 발생했습니다. 그래도 계속 진행하시겠습니까?');
    return continueAnyway;
  }
}

// 입력 정보 요약 생성
function generateSummary() {
  const summaryContent = document.getElementById('summary-content');
  if (!summaryContent) return;
  
  const name = document.getElementById('name').value.trim();
  const ssnFront = document.getElementById('ssnFront').value;
  const ssnBack = document.getElementById('ssnBack').value;
  const email = document.getElementById('email').value.trim();
  const phoneCarrier = document.getElementById('phoneCarrier').value;
  const phone = document.getElementById('phone').value.trim();
  const postcode = document.getElementById('postcode').value;
  const address = document.getElementById('address').value.trim();
  const addressDetail = document.getElementById('addressDetail').value.trim();
  const bank = document.getElementById('bank').value;
  const accountNumber = document.getElementById('accountNumber').value.trim();
  const accountHolder = document.getElementById('accountHolder').value.trim();
  const education = document.getElementById('education').value;
  const schoolName = document.getElementById('schoolName').value.trim();
  const major = document.getElementById('major').value.trim();
  const experience = document.querySelector('input[name="experience"]:checked')?.value;
  const experienceYears = document.getElementById('experienceYears').value;
  const prevCompany = document.getElementById('prevCompany').value.trim();
  
  let summaryHTML = `
    <div class="summary-section">
      <div class="summary-title">기본 정보</div>
      <div class="summary-item">
        <span class="summary-label">성함</span>
        <span class="summary-value">${name}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">주민등록번호</span>
        <span class="summary-value">${ssnFront}-${ssnBack.substring(0,1)}******</span>
      </div>
    </div>
    
    <div class="summary-section">
      <div class="summary-title">연락처 정보</div>
      <div class="summary-item">
        <span class="summary-label">핸드폰</span>
        <span class="summary-value">${phoneCarrier} ${phone}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">이메일</span>
        <span class="summary-value">${email}</span>
      </div>
    </div>
    
    <div class="summary-section">
      <div class="summary-title">주소 정보</div>
      <div class="summary-item">
        <span class="summary-label">우편번호</span>
        <span class="summary-value">${postcode}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">주소</span>
        <span class="summary-value">${address} ${addressDetail}</span>
      </div>
    </div>
    
    <div class="summary-section">
      <div class="summary-title">계좌 정보</div>
      <div class="summary-item">
        <span class="summary-label">은행</span>
        <span class="summary-value">${bank}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">계좌번호</span>
        <span class="summary-value">${accountNumber}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">예금주</span>
        <span class="summary-value">${accountHolder}</span>
      </div>
    </div>
    
    <div class="summary-section">
      <div class="summary-title">학력 및 경력</div>
      <div class="summary-item">
        <span class="summary-label">최종 학력</span>
        <span class="summary-value">${education}</span>
      </div>
      ${schoolName ? `
      <div class="summary-item">
        <span class="summary-label">학교명</span>
        <span class="summary-value">${schoolName}</span>
      </div>
      ` : ''}
      ${major ? `
      <div class="summary-item">
        <span class="summary-label">전공</span>
        <span class="summary-value">${major}</span>
      </div>
      ` : ''}
      <div class="summary-item">
        <span class="summary-label">경력 구분</span>
        <span class="summary-value">${experience}</span>
      </div>
      ${experience === '경력' && experienceYears ? `
      <div class="summary-item">
        <span class="summary-label">경력 연수</span>
        <span class="summary-value">${experienceYears}</span>
      </div>
      ` : ''}
      ${experience === '경력' && prevCompany ? `
      <div class="summary-item">
        <span class="summary-label">이전 회사</span>
        <span class="summary-value">${prevCompany}</span>
      </div>
      ` : ''}
    </div>
  `;
  
  summaryContent.innerHTML = summaryHTML;
}

// 단계별 입력 필드 검증 이벤트 리스너 설정
function setupStepValidation() {
  // 1단계 필드들
  ['name', 'ssnFront', 'ssnBack'].forEach(id => {
    const field = document.getElementById(id);
    if (field) {
      field.addEventListener('input', () => {
        if (currentStep === 1) {
          updateNavigationButtons();
        }
      });
      // 엔터키 이벤트 추가
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && currentStep === 1) {
          e.preventDefault();
          if (validateCurrentStep()) {
            goToStep(currentStep + 1);
          }
        }
      });
    }
  });
  
  // 2단계 필드들
  ['phoneCarrier', 'phone', 'email'].forEach(id => {
    const field = document.getElementById(id);
    if (field) {
      field.addEventListener('input', () => {
        if (currentStep === 2) {
          updateNavigationButtons();
        }
      });
      field.addEventListener('change', () => {
        if (currentStep === 2) {
          updateNavigationButtons();
        }
      });
      // 엔터키 이벤트 추가
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && currentStep === 2) {
          e.preventDefault();
          if (validateCurrentStep()) {
            goToStep(currentStep + 1);
          }
        }
      });
    }
  });
  
  // 3단계 필드들
  ['postcode', 'addressDetail'].forEach(id => {
    const field = document.getElementById(id);
    if (field) {
      field.addEventListener('input', () => {
        if (currentStep === 3) {
          updateNavigationButtons();
        }
      });
      // 엔터키 이벤트 추가
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && currentStep === 3) {
          e.preventDefault();
          if (validateCurrentStep()) {
            goToStep(currentStep + 1);
          }
        }
      });
    }
  });
  
  // 4단계 필드들
  ['bank', 'accountNumber', 'accountHolder'].forEach(id => {
    const field = document.getElementById(id);
    if (field) {
      field.addEventListener('input', () => {
        if (currentStep === 4) {
          updateNavigationButtons();
        }
      });
      field.addEventListener('change', () => {
        if (currentStep === 4) {
          updateNavigationButtons();
        }
      });
      // 엔터키 이벤트 추가
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && currentStep === 4) {
          e.preventDefault();
          if (validateCurrentStep()) {
            goToStep(currentStep + 1);
          }
        }
      });
    }
  });
  
  // 5단계 필드들
  const education = document.getElementById('education');
  if (education) {
    education.addEventListener('change', () => {
      if (currentStep === 5) {
        updateNavigationButtons();
      }
    });
    // 엔터키 이벤트 추가
    education.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && currentStep === 5) {
        e.preventDefault();
        if (validateCurrentStep()) {
          goToStep(currentStep + 1);
        }
      }
    });
  }
  
  // 5단계 추가 필드들 (schoolName, major, experienceYears, prevCompany)
  const schoolName = document.getElementById('schoolName');
  if (schoolName) {
    schoolName.addEventListener('input', () => {
      if (currentStep === 5) {
        updateNavigationButtons();
      }
    });
    // 엔터키 이벤트 추가
    schoolName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && currentStep === 5) {
        e.preventDefault();
        if (validateCurrentStep()) {
          goToStep(currentStep + 1);
        }
      }
    });
  }
  
  const major = document.getElementById('major');
  if (major) {
    major.addEventListener('input', () => {
      if (currentStep === 5) {
        updateNavigationButtons();
      }
    });
    // 엔터키 이벤트 추가
    major.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && currentStep === 5) {
        e.preventDefault();
        if (validateCurrentStep()) {
          goToStep(currentStep + 1);
        }
      }
    });
  }
  
  const experienceYears = document.getElementById('experienceYears');
  if (experienceYears) {
    experienceYears.addEventListener('change', () => {
      if (currentStep === 5) {
        updateNavigationButtons();
      }
    });
    // 엔터키 이벤트 추가
    experienceYears.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && currentStep === 5) {
        e.preventDefault();
        if (validateCurrentStep()) {
          goToStep(currentStep + 1);
        }
      }
    });
  }
  
  const prevCompany = document.getElementById('prevCompany');
  if (prevCompany) {
    prevCompany.addEventListener('input', () => {
      if (currentStep === 5) {
        updateNavigationButtons();
      }
    });
    // 엔터키 이벤트 추가
    prevCompany.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && currentStep === 5) {
        e.preventDefault();
        if (validateCurrentStep()) {
          goToStep(currentStep + 1);
        }
      }
    });
  }
  
  const experienceRadios = document.querySelectorAll('input[name="experience"]');
  experienceRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (currentStep === 5) {
        updateNavigationButtons();
      }
    });
    // 엔터키 이벤트 추가
    radio.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && currentStep === 5) {
        e.preventDefault();
        if (validateCurrentStep()) {
          goToStep(currentStep + 1);
        }
      }
    });
  });
  
  // 6단계 필드들
  const agree1 = document.getElementById('agree1');
  if (agree1) {
    agree1.addEventListener('change', () => {
      if (currentStep === 6) {
        updateNavigationButtons();
      }
      // 동의 상태 변경 시 제출 버튼 상태 업데이트
      updateSubmitButton();
    });
    // 엔터키 이벤트 추가 (6단계에서 7단계로 이동)
    agree1.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && currentStep === 6) {
        e.preventDefault();
        if (validateCurrentStep()) {
          goToStep(currentStep + 1);
        }
      }
    });
  }
  
  // 6단계 전체에서 엔터키 이벤트 추가 (요약 단계)
  const step6Section = document.querySelector('.step-section[data-step="6"]');
  if (step6Section) {
    step6Section.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && currentStep === 6) {
        e.preventDefault();
        if (validateCurrentStep()) {
          goToStep(currentStep + 1);
        }
      }
    });
  }
  
  // 7단계 필드들 (동의 체크박스)
  const agree2 = document.getElementById('agree2');
  if (agree2) {
    agree2.addEventListener('change', () => {
      if (currentStep === 7) {
        updateNavigationButtons();
      }
      // 동의 상태 변경 시 제출 버튼 상태 업데이트
      updateSubmitButton();
    });
    // 엔터키 이벤트 추가 (7단계에서 제출)
    agree2.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && currentStep === 7) {
        e.preventDefault();
        if (validateCurrentStep()) {
          // 7단계는 마지막 단계이므로 제출 버튼 클릭
          const submitBtn = document.getElementById('submit-btn');
          if (submitBtn && !submitBtn.disabled) {
            submitBtn.click();
          }
        }
      }
    });
  }
  
  // 7단계 전체에서 엔터키 이벤트 추가 (동의 및 제출 단계)
  const step7Section = document.querySelector('.step-section[data-step="7"]');
  if (step7Section) {
    step7Section.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && currentStep === 7) {
        e.preventDefault();
        if (validateCurrentStep()) {
          // 7단계는 마지막 단계이므로 제출 버튼 클릭
          const submitBtn = document.getElementById('submit-btn');
          if (submitBtn && !submitBtn.disabled) {
            submitBtn.click();
          }
        }
      }
    });
  }
  
  // 제출하기 버튼에 엔터키 이벤트 추가
  const submitBtnForEnter = document.getElementById('submit-btn');
  if (submitBtnForEnter) {
    submitBtnForEnter.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && currentStep === 7) {
        e.preventDefault();
        if (validateCurrentStep()) {
          // 제출 버튼 클릭 이벤트 트리거
          submitBtnForEnter.click();
        }
      }
    });
  }
}

// DOM 로드 완료 시 초기화
document.addEventListener('DOMContentLoaded', async function() {
  // 시험 정보 로드
  const isValidAccess = await loadExamInfo();
  if (!isValidAccess) {
    return; // 잘못된 접근인 경우 더 이상 진행하지 않음
  }
  
  // 각종 이벤트 리스너 설정
  setupAutoMove();
  setupPhoneFormatting();
  setupAccountNumberFormatting();
  setupExperienceFields();
  setupConsentCheckbox();
  setupModals();
  setupStepValidation();
  
  // 단계별 폼 초기화
  updateProgressBar();
  updateStepLabels();
  updateNavigationButtons();
  
  // 제출 버튼 초기 상태 설정
  updateSubmitButton();
  
  // 네비게이션 버튼 이벤트 리스너
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const submitBtn = document.getElementById('submit-btn');
  
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      goToStep(currentStep - 1);
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', async () => {
      if (validateCurrentStep()) {
        await goToStep(currentStep + 1);
      }
    });
  }
  
  if (submitBtn) {
    submitBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      
      if (!validateForm()) {
        // 첫 번째 에러 필드로 스크롤
        const firstError = document.querySelector('.error');
        if (firstError) {
          firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }
      
      // 제출 버튼 비활성화
      const originalText = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 제출 중...';
      
      try {
        // 폼 데이터 수집
        const formData = {
          examId: document.getElementById('examId').value || null,
          managerCode: document.getElementById('managerCode').value || null,
          applicationType: document.getElementById('managerCode').value ? 'manager_referral' : (document.getElementById('examId').value ? 'admin_referral' : 'direct_application'),
          name: document.getElementById('name').value.trim(),
          ssn: document.getElementById('ssnFront').value + '-' + document.getElementById('ssnBack').value,
          email: document.getElementById('email').value.trim(),
          phoneCarrier: document.getElementById('phoneCarrier').value,
          phone: document.getElementById('phone').value.trim(),
          postcode: document.getElementById('postcode').value,
          address: document.getElementById('address').value.trim(),
          addressDetail: document.getElementById('addressDetail').value.trim(),
          bank: document.getElementById('bank').value,
          accountNumber: document.getElementById('accountNumber').value.trim(),
          accountHolder: document.getElementById('accountHolder').value.trim(),
          education: document.getElementById('education').value,
          schoolName: document.getElementById('schoolName').value.trim(),
          major: document.getElementById('major').value.trim(),
          experience: document.querySelector('input[name="experience"]:checked').value,
          experienceYears: document.getElementById('experienceYears').value,
          prevCompany: document.getElementById('prevCompany').value.trim(),
          agree1: document.getElementById('agree1').checked,
          agree2: document.getElementById('agree2').checked
        };
        
        await submitForm(formData);
        
      } catch (error) {
        console.error('폼 제출 오류:', error);
        alert('제출 중 오류가 발생했습니다. 다시 시도해주세요.');
        
        // 제출 버튼 복원
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    });
  }
  
});