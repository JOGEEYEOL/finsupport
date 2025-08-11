import { db, collection, addDoc } from "../common/config/database.js";
import { getDocs, collection as fsCollection, query, where } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-firestore.js";
import { Timestamp } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-firestore.js";

// URL 파라미터 파싱
function getUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  return {
    examId: urlParams.get('exam'),
    managerCode: urlParams.get('manager')
  };
}

// 시험 정보 로드 및 표시
async function loadExamInfo() {
  const { examId, managerCode } = getUrlParams();
  
  // 파라미터가 없는 경우 (일반 지원자) - 기본 정보 표시
  if (!examId && !managerCode) {
    displayDefaultInfo();
    return true;
  }
  
  // 파라미터가 일부만 있는 경우
  if (!examId || !managerCode) {
    showError('링크가 올바르지 않습니다. 담당자에게 다시 확인해주세요.');
    return false;
  }
  
  try {
    // 시험 정보 조회
    const examQuery = query(fsCollection(db, 'examSchedules'), where('id', '==', examId));
    const examSnapshot = await getDocs(examQuery);
    
    if (examSnapshot.empty) {
      showError('시험 정보를 찾을 수 없습니다.');
      return false;
    }
    
    const examData = examSnapshot.docs[0].data();
    
    // 담당자 정보 조회
    const managerQuery = query(fsCollection(db, 'managers'), where('code', '==', managerCode));
    const managerSnapshot = await getDocs(managerQuery);
    
    if (managerSnapshot.empty) {
      showError('담당자 정보를 찾을 수 없습니다.');
      return false;
    }
    
    const managerData = managerSnapshot.docs[0].data();
    
    // 시험 정보 표시
    displayExamInfo(examData, managerData);
    
    // 히든 필드에 값 설정
    document.getElementById('examId').value = examId;
    document.getElementById('managerCode').value = managerCode;
    
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
  
  examDetails.innerHTML = `
    <div class="exam-item">
      <i class="fas fa-info-circle"></i>
      <span><strong>일반 지원:</strong> 생명보험자격시험 위촉자 지원</span>
    </div>
    <div class="exam-item">
      <i class="fas fa-globe"></i>
      <span><strong>온라인 지원:</strong> 온라인으로 직접 지원하신 경우입니다</span>
    </div>
    <div class="exam-item">
      <i class="fas fa-phone"></i>
      <span><strong>문의:</strong> 담당자 배정 후 연락드리겠습니다</span>
    </div>
  `;
}

// 시험 정보 표시 (담당자 연결된 경우)
function displayExamInfo(examData, managerData) {
  const examDetails = document.getElementById('exam-details');
  if (!examDetails) return;
  
  examDetails.innerHTML = `
    <div class="exam-item">
      <i class="fas fa-book"></i>
      <span><strong>시험명:</strong> ${examData.examName || '생명보험자격시험'}</span>
    </div>
    <div class="exam-item">
      <i class="fas fa-calendar"></i>
      <span><strong>시험일:</strong> ${examData.examDate || ''}</span>
    </div>
    <div class="exam-item">
      <i class="fas fa-clock"></i>
      <span><strong>접수기간:</strong> ${examData.applicationPeriod || ''}</span>
    </div>
    <div class="exam-item">
      <i class="fas fa-user-tie"></i>
      <span><strong>담당자:</strong> ${managerData.name || ''} (${managerData.team || ''}팀)</span>
    </div>
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
  };
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
  
  return errors.length === 0;
}

// 폼 제출
async function submitForm(formData) {
  try {
    // Firestore에 위촉자 정보 저장
    const docRef = await addDoc(collection(db, 'applicants'), {
      ...formData,
      status: 'pending',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
    
    console.log('위촉자 정보 저장 완료:', docRef.id);
    
    // 성공 메시지 표시
    showSuccessMessage();
    
  } catch (error) {
    console.error('위촉자 정보 저장 실패:', error);
    alert('정보 저장 중 오류가 발생했습니다. 다시 시도해주세요.');
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
  
  // 폼 제출 이벤트
  const form = document.getElementById('applicantInfoForm');
  if (form) {
    form.addEventListener('submit', async function(e) {
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
      const submitBtn = document.querySelector('.submit-btn');
      const originalText = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 제출 중...';
      
      try {
        // 폼 데이터 수집
        const formData = {
          examId: document.getElementById('examId').value || null, // 빈 값은 null로 처리
          managerCode: document.getElementById('managerCode').value || null, // 빈 값은 null로 처리
          applicationType: document.getElementById('examId').value ? 'manager_referral' : 'direct_application', // 지원 유형 구분
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
          major: document.getElementById('major').value.trim(),
          experience: document.querySelector('input[name="experience"]:checked').value,
          experienceYears: document.getElementById('experienceYears').value,
          prevCompany: document.getElementById('prevCompany').value.trim()
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