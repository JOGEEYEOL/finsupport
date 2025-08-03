import { initializeApp } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-app.js";
import { getFirestore, collection, getDocs, query, where, doc, updateDoc, onSnapshot, orderBy } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-functions.js";

// Firebase 설정
const firebaseConfig = {
  apiKey: 'AIzaSyA-N7FA3LyOs35W4-LQPnsJAo313mSG8XY',
  authDomain: 'client-insurance-42400.firebaseapp.com',
  projectId: 'client-insurance-42400',
  storageBucket: 'client-insurance-42400.firebasestorage.app',
  messagingSenderId: '1093798525474',
  appId: '1:1093798525474:web:05a799e12064fae4c9e87b',
  measurementId: 'G-R9WCBDJX1F'
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const functions = getFunctions(app);

// 전역 변수
let currentManager = null;
let currentClients = [];
let currentEditField = null;
let currentInsuranceCompany = null;
let currentEditingClient = null;
let isEditingClient = false;

// 보험사 목록 정의
const lifeInsuranceCompanies = [
  { name: 'ABL생명', key: 'abl' },
  { name: '흥국생명', key: 'heungkuk_life' },
  { name: '라이나생명', key: 'lina' },
  { name: '동양생명', key: 'dongyang' },
  { name: '미래에셋생명', key: 'mirae' },
  { name: '처브라이프생명', key: 'chubb_life' },
  { name: 'KB생명', key: 'kb_life' },
  { name: 'KDB생명', key: 'kdb' },
  { name: '삼성생명', key: 'samsung_life' },
  { name: '농협생명', key: 'nh_life' },
  { name: 'DGB생명', key: 'dgb' },
  { name: '한화생명', key: 'hanwha_life' },
  { name: '카디프생명', key: 'cardif' },
  { name: '신한라이프', key: 'shinhan' },
  { name: '오렌지라이프', key: 'orange' },
  { name: '푸본현대생명', key: 'fubon' },
  { name: '푸르덴셜생명', key: 'prudential' },
  { name: '메트라이프생명', key: 'metlife' },
  { name: '하나생명', key: 'hana_life' },
  { name: '교보생명', key: 'kyobo' }
];

const nonLifeInsuranceCompanies = [
  { name: '메리츠화재', key: 'meritz' },
  { name: '한화손해', key: 'hanwha_nonlife' },
  { name: '현대해상', key: 'hyundai' },
  { name: 'DB손해', key: 'db' },
  { name: '삼성화재', key: 'samsung_fire' },
  { name: 'KB손해', key: 'kb_nonlife' },
  { name: 'MG손해보험', key: 'mg' },
  { name: '롯데손보', key: 'lotte' },
  { name: '흥국화재', key: 'heungkuk_fire' },
  { name: '농협손보', key: 'nh_nonlife' },
  { name: '하나손해', key: 'hana_nonlife' },
  { name: '처브손해', key: 'chubb_nonlife' }
];

// 로그인 함수
window.login = async function() {
  const code = document.getElementById('manager-code').value.trim();
  const password = document.getElementById('manager-password').value.trim();
  const errorDiv = document.getElementById('login-error');
  const loginBtn = document.getElementById('login-btn');

  console.log('로그인 시도:', { code, password: password ? '****' : '없음' });

  if (!code || !password) {
    showError(errorDiv, '담당자 코드와 비밀번호를 입력해주세요.');
    return;
  }

  try {
    loginBtn.disabled = true;
    loginBtn.textContent = '로그인 중...';
    errorDiv.style.display = 'none';

    // Firebase Functions 호출
    console.log('Firebase Functions 호출 중...', { code });
    const authenticateManager = httpsCallable(functions, 'authenticateManager');
    const result = await authenticateManager({ code, password });

    if (result.data.manager) {
      currentManager = result.data.manager;
      
      // 초기 비밀번호(0000) 사용 시 강제 변경 요구
      if (password === '0000') {
        alert('🔐 초기 비밀번호를 사용하고 있습니다.\n보안을 위해 비밀번호를 변경해주세요.');
        
        // 비밀번호 변경 모달 즉시 표시
        changePassword();
        
        // 메인 페이지는 표시하되 배경 처리
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('main-container').style.display = 'flex';
      } else {
        // 일반 로그인 성공 - 메인 페이지 표시
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('main-container').style.display = 'flex';
      }
      
      // 모바일에서만 햄버거 버튼 표시
      const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
      if (mobileMenuToggle) {
        // 화면 크기에 따라 햄버거 버튼 표시/숨김
        if (window.innerWidth <= 768) {
          mobileMenuToggle.style.display = 'flex';
        } else {
          mobileMenuToggle.style.display = 'none';
        }
      }
      
      // 담당자 정보 표시
      updateManagerInfo();
      
      // 초기 데이터 로드
      await loadManagerProfile();
      await loadManagerClients();
      await loadInsuranceAccounts();


    } else {
      showError(errorDiv, '로그인에 실패했습니다.');
    }
  } catch (error) {
    console.error('로그인 에러:', error);
    let errorMessage = '로그인 중 오류가 발생했습니다.';
    
    if (error.code === 'functions/not-found') {
      errorMessage = '존재하지 않는 담당자 코드입니다.';
    } else if (error.code === 'functions/permission-denied') {
      errorMessage = '비밀번호가 일치하지 않습니다.';
    } else if (error.code === 'functions/failed-precondition') {
      errorMessage = '비밀번호가 설정되지 않았습니다. 관리자에게 문의하세요.';
    }
    
    showError(errorDiv, errorMessage);
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = '로그인';
  }
};

// 로그아웃 함수
window.logout = function() {
  if (confirm('로그아웃 하시겠습니까?')) {
    currentManager = null;
    currentClients = [];
    
    // 로그인 폼을 원래 상태로 복원
    const loginForm = document.getElementById('login-form');
    loginForm.style.display = 'flex';
    loginForm.style.position = 'fixed';
    loginForm.style.top = '0';
    loginForm.style.left = '0';
    loginForm.style.width = '100%';
    loginForm.style.height = '100%';
    loginForm.style.alignItems = 'center';
    loginForm.style.justifyContent = 'center';
    loginForm.style.zIndex = '1000';
    
    document.getElementById('main-container').style.display = 'none';
    
    // 모바일 햄버거 버튼 숨기기
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    if (mobileMenuToggle) {
      mobileMenuToggle.style.display = 'none';
      closeMobileMenu(); // 메뉴가 열려있다면 닫기
    }
    
    // 입력 필드 초기화
    document.getElementById('manager-code').value = '';
    document.getElementById('manager-password').value = '';
    document.getElementById('login-error').style.display = 'none';
  }
};

// 에러 메시지 표시 함수
function showError(element, message) {
  element.textContent = message;
  element.style.display = 'block';
}

// 담당자 정보 업데이트
function updateManagerInfo() {
  if (!currentManager) return;

  document.getElementById('current-manager-name').textContent = currentManager.name || '';
  document.getElementById('current-manager-code').textContent = currentManager.code || '';
  document.getElementById('current-manager-team').textContent = currentManager.team || '';
}

// 담당자 프로필 로드
async function loadManagerProfile() {
  if (!currentManager) return;

  document.getElementById('profile-name').textContent = currentManager.name || '';
  document.getElementById('profile-code').textContent = currentManager.code || '';
  document.getElementById('profile-team').textContent = currentManager.team || '';
  document.getElementById('profile-role').textContent = currentManager.role || '';
  document.getElementById('profile-phone').textContent = currentManager.phone || '';
  document.getElementById('profile-email').textContent = currentManager.email || '';
}

// 담당자별 고객 목록 로드
async function loadManagerClients() {
  if (!currentManager) return;

  try {
    const clientsRef = collection(db, 'client_info');
    const q = query(clientsRef, where('manager', '==', currentManager.name), orderBy('created_at', 'desc'));
    
    onSnapshot(q, (snapshot) => {
      currentClients = [];
      snapshot.forEach(doc => {
        currentClients.push({
          id: doc.id,
          ...doc.data()
        });
      });
      renderClientList();
    });
  } catch (error) {
    console.error('고객 목록 로드 실패:', error);
  }
}

// 고객 목록 렌더링
function renderClientList(searchTerm = '') {
  const clientList = document.getElementById('client-list');
  if (!clientList) return;

  let filteredClients = currentClients;
  
  if (searchTerm) {
    filteredClients = currentClients.filter(client => 
      (client.name && client.name.includes(searchTerm)) ||
      (client.phone && client.phone.includes(searchTerm))
    );
  }

  if (filteredClients.length === 0) {
    clientList.innerHTML = '<div class="no-data">담당 고객이 없습니다.</div>';
    return;
  }

  clientList.innerHTML = filteredClients.map(client => {
    const createdAt = client.created_at ? new Date(client.created_at.seconds * 1000) : new Date();
    const dateStr = createdAt.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    return `
      <div class="client-card" onclick="showClientDetail('${client.id}')">
        <div class="card-header">
          <h4>${client.name || '이름 없음'}</h4>
          <span class="date">${dateStr}</span>
        </div>
        <div class="card-body">
          <div class="info-item">
            <i class="fas fa-phone"></i>
            <span>${client.phone || '연락처 없음'}</span>
          </div>
          ${client.occupation ? `
            <div class="info-item">
              <i class="fas fa-briefcase"></i>
              <span>${client.occupation}</span>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// 주민등록번호 복호화 함수
async function decryptSSN(encryptedSSN) {
  if (!encryptedSSN) return '-';
  
  try {
    // 이미 평문인 경우 (길이가 짧거나 특수문자 포함)
    if (encryptedSSN.length < 16 || encryptedSSN.includes('-')) {
      return encryptedSSN;
    }
    
    // Firebase Functions를 통해 복호화
    const decryptSSNFunction = httpsCallable(functions, 'decryptSSN');
    const result = await decryptSSNFunction({ ssn: encryptedSSN });
    
    if (result.data && result.data.ssn) {
      return result.data.ssn;
    } else {
      return encryptedSSN;
    }
  } catch (error) {
    console.error('주민등록번호 복호화 실패:', error);
    return encryptedSSN;
  }
}

// 파일 크기 포맷팅 함수
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 고객 상세 정보 표시
window.showClientDetail = async function(clientId) {
  const client = currentClients.find(c => c.id === clientId);
  if (!client) return;

  // 현재 편집 중인 고객 정보 저장
  currentEditingClient = client;
  
  // 수정 모드 상태 초기화
  isEditingClient = false;
  currentEditingSection = null;

  const modal = document.getElementById('clientModal');
  const content = document.getElementById('client-modal-content');
  const title = document.getElementById('client-modal-title');

  title.textContent = `${client.name || '고객'}님 상세 정보`;

  // 등록일 포맷팅
  const createdAt = client.created_at ? new Date(client.created_at.seconds * 1000) : new Date();
  const dateStr = createdAt.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  // 주민등록번호 복호화
  const decryptedSSN = await decryptSSN(client.ssn);

  content.innerHTML = `
    <div class="client-detail">
      <!-- 기본 정보 -->
      <div class="detail-section">
        <h5><i class="fas fa-user"></i> 기본 정보</h5>
        <div class="detail-grid">
          <div class="detail-item">
            <label>이름:</label>
            <span>${client.name || '-'}</span>
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
        <div class="section-header">
          <h5><i class="fas fa-phone"></i> 연락처 정보</h5>
          <button class="field-edit-btn" onclick="editSection('contact')" data-section="contact">
            <i class="fas fa-edit"></i> 수정
          </button>
        </div>
        <div class="detail-grid">
          <div class="detail-item">
            <label>통신사:</label>
            <span data-field="phoneCarrier">${client.phoneCarrier || '-'}</span>
          </div>
          <div class="detail-item">
            <label>핸드폰번호:</label>
            <span data-field="phone">${client.phone || '-'}</span>
          </div>
          <div class="detail-item">
            <label>지역번호:</label>
            <span data-field="areaCode">${client.areaCode || '-'}</span>
          </div>
          <div class="detail-item">
            <label>회사전화:</label>
            <span data-field="companyPhone">${client.companyPhone || '-'}</span>
          </div>
          <div class="detail-item">
            <label>동일번호:</label>
            <span>${client.samePhone ? '예' : '아니오'}</span>
          </div>
        </div>
      </div>
      
      <!-- 주소 정보 -->
      <div class="detail-section">
        <div class="section-header">
          <h5><i class="fas fa-map-marker-alt"></i> 주소 정보</h5>
          <button class="field-edit-btn" onclick="editSection('address')" data-section="address">
            <i class="fas fa-edit"></i> 수정
          </button>
        </div>
        <div class="detail-grid">
          <div class="detail-item">
            <label>우편번호:</label>
            <span data-field="postcode">${client.postcode || '-'}</span>
          </div>
          <div class="detail-item full-width">
            <label>주소:</label>
            <span data-field="address">${client.address || '-'}</span>
          </div>
          <div class="detail-item full-width">
            <label>상세주소:</label>
            <span data-field="addressDetail">${client.addressDetail || '-'}</span>
          </div>
        </div>
      </div>
      
      <!-- 직업 정보 -->
      <div class="detail-section">
        <div class="section-header">
          <h5><i class="fas fa-briefcase"></i> 직업 정보</h5>
          <button class="field-edit-btn" onclick="editSection('job')" data-section="job">
            <i class="fas fa-edit"></i> 수정
          </button>
        </div>
        <div class="detail-grid">
          <div class="detail-item">
            <label>직장명:</label>
            <span data-field="occupation">${client.occupation || '-'}</span>
          </div>
          <div class="detail-item">
            <label>하시는 일:</label>
            <span data-field="jobDetail">${client.jobDetail || '-'}</span>
          </div>
          <div class="detail-item">
            <label>직원 수:</label>
            <span data-field="employeeCount">${client.employeeCount ? client.employeeCount + '명' : '-'}</span>
          </div>
        </div>
      </div>
      
      <!-- 신체 정보 -->
      <div class="detail-section">
        <div class="section-header">
          <h5><i class="fas fa-weight"></i> 신체 정보</h5>
          <button class="field-edit-btn" onclick="editSection('body')" data-section="body">
            <i class="fas fa-edit"></i> 수정
          </button>
        </div>
        <div class="detail-grid">
          <div class="detail-item">
            <label>키:</label>
            <span data-field="height">${client.height ? client.height + 'cm' : '-'}</span>
          </div>
          <div class="detail-item">
            <label>몸무게:</label>
            <span data-field="weight">${client.weight ? client.weight + 'kg' : '-'}</span>
          </div>
          <div class="detail-item">
            <label>운전여부:</label>
            <span data-field="driving">${client.driving === 'yes' ? '예' : client.driving === 'no' ? '아니오' : '-'}</span>
          </div>
        </div>
      </div>
      
      <!-- 의료 정보 -->
      <div class="detail-section">
        <div class="section-header">
          <h5><i class="fas fa-notes-medical"></i> 의료 정보</h5>
          <button class="field-edit-btn" onclick="editSection('medical')" data-section="medical">
            <i class="fas fa-edit"></i> 수정
          </button>
        </div>
        <div class="detail-grid">
          <div class="detail-item full-width">
            <label>치료이력:</label>
            <div class="detail-textarea" data-field="medicalHistory">
              ${client.medicalHistory || '-'}
            </div>
          </div>
        </div>
      </div>
      
      <!-- 동의 정보 -->
      <div class="detail-section">
        <h5><i class="fas fa-check-circle"></i> 동의 정보</h5>
        <div class="detail-grid">
          <div class="detail-item">
            <label>개인정보 수집·이용 동의:</label>
            <span class="${client.agree1 ? 'agree-yes' : 'agree-no'}">
              <i class="fas ${client.agree1 ? 'fa-check-circle' : 'fa-times-circle'}"></i>
              ${client.agree1 ? '동의' : '미동의'}
            </span>
          </div>
          <div class="detail-item">
            <label>개인정보 제3자 제공 동의:</label>
            <span class="${client.agree2 ? 'agree-yes' : 'agree-no'}">
              <i class="fas ${client.agree2 ? 'fa-check-circle' : 'fa-times-circle'}"></i>
              ${client.agree2 ? '동의' : '미동의'}
            </span>
          </div>
        </div>
      </div>
      
      ${client.memo ? `
        <div class="detail-section">
          <div class="section-header">
            <h5><i class="fas fa-sticky-note"></i> 메모</h5>
            <button class="field-edit-btn" onclick="editSection('memo')" data-section="memo">
              <i class="fas fa-edit"></i> 수정
            </button>
          </div>
          <div class="detail-grid">
            <div class="detail-item full-width">
              <div class="detail-textarea" data-field="memo">
                ${client.memo}
              </div>
            </div>
          </div>
        </div>
      ` : ''}
      
      ${client.attachments && Object.keys(client.attachments).length > 0 ? `
        <div class="detail-section">
          <h5><i class="fas fa-paperclip"></i> 첨부파일</h5>
          <div class="attachments-list">
            ${Object.entries(client.attachments).map(([fileName, fileUrl]) => `
              <div class="attachment-item">
                <i class="fas ${fileName.toLowerCase().includes('.pdf') ? 'fa-file-pdf' : 'fa-file-image'}"></i>
                <a href="${fileUrl}" target="_blank" rel="noopener noreferrer">
                  ${fileName}
                </a>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  modal.style.display = 'block';
};

// 보험사 계정 정보 로드
async function loadInsuranceAccounts() {
  if (!currentManager || !currentManager.insuranceAccounts) {
    renderInsuranceList(lifeInsuranceCompanies, 'life-insurance-list');
    renderInsuranceList(nonLifeInsuranceCompanies, 'nonlife-insurance-list');
    return;
  }

  renderInsuranceList(lifeInsuranceCompanies, 'life-insurance-list');
  renderInsuranceList(nonLifeInsuranceCompanies, 'nonlife-insurance-list');
}

// 보험사 목록 렌더링 (카드 형식)
function renderInsuranceList(companies, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let registeredCount = 0;
  
  const cardsHtml = companies.map(company => {
    const account = currentManager?.insuranceAccounts?.[company.key];
    const hasAccount = account && (account.employeeId || account.password);
    
    if (hasAccount) registeredCount++;
    
    return `
      <div class="insurance-card ${hasAccount ? 'registered' : 'not-registered'}" 
           onclick="editInsuranceAccount('${company.key}', '${company.name}')">
        <div class="insurance-card-header">
          <h5>
            <i class="fas fa-building"></i>
            ${company.name}
          </h5>
        </div>
        <div class="insurance-card-body">
          <div class="insurance-status">
            <div class="status-indicator ${hasAccount ? 'registered' : 'not-registered'}"></div>
            <span class="status-text ${hasAccount ? 'registered' : 'not-registered'}">
              ${hasAccount ? '계정 등록됨' : '계정 미등록'}
            </span>
          </div>
          ${hasAccount ? `
            <div class="account-info">
              <div class="account-detail">
                <span class="account-label">사원번호:</span>
                <span class="account-value">${account.employeeId || '-'}</span>
              </div>
              <div class="account-detail">
                <span class="account-label">비밀번호:</span>
                <span class="account-value">${account.password ? '설정됨' : '미설정'}</span>
              </div>
            </div>
          ` : `
            <div class="account-info">
              <div class="account-detail">
                <span class="account-label">상태:</span>
                <span class="account-value" style="color: #dc3545;">계정 정보 없음</span>
              </div>
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = cardsHtml;
  
  // 카운트 업데이트
  const isLifeInsurance = containerId === 'life-insurance-list';
  const countElement = document.getElementById(isLifeInsurance ? 'life-count' : 'nonlife-count');
  if (countElement) {
    countElement.textContent = `${registeredCount}/${companies.length}`;
  }
}

// 필드 수정 모달 열기
window.editField = function(fieldName) {
  currentEditField = fieldName;
  const modal = document.getElementById('editModal');
  const title = document.getElementById('edit-modal-title');
  const label = document.getElementById('edit-modal-label');
  const input = document.getElementById('edit-modal-input');
  const select = document.getElementById('edit-modal-select');
  const phoneGroup = document.getElementById('phone-input-group');
  const emailGroup = document.getElementById('email-input-group');
  const carrier = document.getElementById('edit-modal-carrier');

  const fieldLabels = {
    team: '팀명',
    role: '직책',
    phone: '연락처',
    email: '이메일'
  };

  title.textContent = `${fieldLabels[fieldName]} 수정`;
  label.textContent = `${fieldLabels[fieldName]}:`;

  // 모든 입력 요소 숨기기
  input.style.display = 'none';
  select.style.display = 'none';
  phoneGroup.style.display = 'none';
  emailGroup.style.display = 'none';

  if (fieldName === 'role') {
    // 직책 선택박스
    select.innerHTML = `
      <option value="">직책 선택</option>
      <option value="BM">BM</option>
      <option value="ABM">ABM</option>
      <option value="SM">SM</option>
      <option value="ASM">ASM</option>
      <option value="팀장">팀장</option>
    `;
    select.value = currentManager[fieldName] || '';
    select.style.display = 'block';
    select.focus();
  } else if (fieldName === 'phone') {
    // 연락처 입력 (통신사 + 전화번호)
    const currentPhone = currentManager[fieldName] || '';
    const parts = currentPhone.split(' ');
    
    const phone1 = document.getElementById('edit-modal-phone1');
    const phone2 = document.getElementById('edit-modal-phone2');
    const phone3 = document.getElementById('edit-modal-phone3');
    
    if (parts.length >= 2) {
      carrier.value = parts[0];
      const phoneNumber = parts.slice(1).join(' ').replace(/\-/g, '');
      
      // 전화번호를 자릿수별로 분리
      if (phoneNumber.length >= 3) {
        phone1.value = phoneNumber.substring(0, 3);
      }
      if (phoneNumber.length >= 7) {
        phone2.value = phoneNumber.substring(3, 7);
      }
      if (phoneNumber.length >= 11) {
        phone3.value = phoneNumber.substring(7, 11);
      }
    } else {
      carrier.value = '';
      const phoneNumber = currentPhone.replace(/\-/g, '');
      if (phoneNumber.length >= 3) {
        phone1.value = phoneNumber.substring(0, 3);
      }
      if (phoneNumber.length >= 7) {
        phone2.value = phoneNumber.substring(3, 7);
      }
      if (phoneNumber.length >= 11) {
        phone3.value = phoneNumber.substring(7, 11);
      }
    }
    
    phoneGroup.style.display = 'block';
    carrier.focus();
    
    // 숫자만 입력 가능하도록 이벤트 리스너 추가
    [phone1, phone2, phone3].forEach(input => {
      input.addEventListener('input', function(e) {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
      });
      
      input.addEventListener('keyup', function(e) {
        if (e.target.value.length === e.target.maxLength) {
          const nextInput = e.target.nextElementSibling?.nextElementSibling;
          if (nextInput && nextInput.tagName === 'INPUT') {
            nextInput.focus();
          }
        }
      });
    });
  } else if (fieldName === 'email') {
    // 이메일 입력 (아이디 + 도메인)
    const currentEmail = currentManager[fieldName] || '';
    const emailId = document.getElementById('edit-modal-email-id');
    const emailDomain = document.getElementById('edit-modal-email-domain');
    const emailCustom = document.getElementById('edit-modal-email-custom');
    
    if (currentEmail.includes('@')) {
      const [id, domain] = currentEmail.split('@');
      emailId.value = id;
      
      // 도메인이 옵션에 있는지 확인
      const domainOptions = Array.from(emailDomain.options).map(opt => opt.value);
      if (domainOptions.includes(domain)) {
        emailDomain.value = domain;
        emailCustom.style.display = 'none';
      } else {
        emailDomain.value = 'custom';
        emailCustom.value = domain;
        emailCustom.style.display = 'block';
      }
    } else {
      emailId.value = currentEmail;
      emailDomain.value = '';
      emailCustom.style.display = 'none';
    }
    
    // 도메인 선택 변경 시 직접입력 필드 토글
    emailDomain.addEventListener('change', function() {
      if (this.value === 'custom') {
        emailCustom.style.display = 'block';
        emailCustom.focus();
      } else {
        emailCustom.style.display = 'none';
        emailCustom.value = '';
      }
    });
    
    emailGroup.style.display = 'block';
    emailId.focus();
  } else {
    // 일반 텍스트 입력
    input.value = currentManager[fieldName] || '';
    input.style.display = 'block';
    input.focus();
  }

  modal.style.display = 'block';
};

// 필드 수정 저장
window.saveEdit = async function() {
  if (!currentEditField) return;

  const input = document.getElementById('edit-modal-input');
  const select = document.getElementById('edit-modal-select');
  const carrier = document.getElementById('edit-modal-carrier');
  const phone = document.getElementById('edit-modal-phone');
  
  let newValue = '';

  if (currentEditField === 'role') {
    newValue = select.value.trim();
  } else if (currentEditField === 'phone') {
    const carrierValue = carrier.value.trim();
    const phone1Value = document.getElementById('edit-modal-phone1').value.trim();
    const phone2Value = document.getElementById('edit-modal-phone2').value.trim();
    const phone3Value = document.getElementById('edit-modal-phone3').value.trim();
    
    // 전화번호 조합
    const phoneValue = `${phone1Value}-${phone2Value}-${phone3Value}`;
    
    // 최소한 첫 번째 필드는 입력되어야 함
    if (phone1Value && !carrierValue) {
      alert('통신사를 선택해주세요.');
      return;
    }
    
    // 전화번호가 입력된 경우 3개 필드 모두 확인
    if (phone1Value) {
      if (!phone2Value || !phone3Value) {
        alert('전화번호를 모두 입력해주세요.');
        return;
      }
      
      if (phone1Value.length !== 3 || phone2Value.length !== 4 || phone3Value.length !== 4) {
        alert('올바른 전화번호 형식을 입력해주세요.');
        return;
      }
    }
    
    if (carrierValue && phone1Value && phone2Value && phone3Value) {
      newValue = `${carrierValue} ${phoneValue}`;
    } else if (phone1Value && phone2Value && phone3Value) {
      newValue = phoneValue;
    } else {
      newValue = '';
    }
  } else if (currentEditField === 'email') {
    const emailIdValue = document.getElementById('edit-modal-email-id').value.trim();
    const emailDomainValue = document.getElementById('edit-modal-email-domain').value.trim();
    const emailCustomValue = document.getElementById('edit-modal-email-custom').value.trim();
    
    if (emailIdValue) {
      let domain = '';
      if (emailDomainValue === 'custom') {
        domain = emailCustomValue;
        if (!domain) {
          alert('도메인을 입력해주세요.');
          return;
        }
      } else {
        domain = emailDomainValue;
        if (!domain) {
          alert('도메인을 선택해주세요.');
          return;
        }
      }
      
      // 이메일 형식 검증
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const fullEmail = `${emailIdValue}@${domain}`;
      if (!emailRegex.test(fullEmail)) {
        alert('올바른 이메일 형식을 입력해주세요.');
        return;
      }
      
      newValue = fullEmail;
    } else {
      newValue = '';
    }
  } else {
    newValue = input.value.trim();
  }

  try {
    // Firestore 업데이트
    const managerRef = doc(db, 'managers', currentManager.id);
    await updateDoc(managerRef, {
      [currentEditField]: newValue
    });

    // 로컬 데이터 업데이트
    currentManager[currentEditField] = newValue;
    
    // UI 업데이트
    updateManagerInfo();
    loadManagerProfile();

    closeEditModal();
    alert('정보가 수정되었습니다.');
  } catch (error) {
    console.error('정보 수정 실패:', error);
    alert('정보 수정에 실패했습니다.');
  }
};

// 비밀번호 변경 모달 열기
window.changePassword = function() {
  const modal = document.getElementById('passwordModal');
  modal.style.display = 'block';
  
  // 초기 비밀번호 사용자인 경우 모달 닫기 방지
  if (currentManager && document.getElementById('manager-password').value === '0000') {
    // X 버튼과 취소 버튼 숨기기
    const closeBtn = modal.querySelector('.close');
    const cancelBtn = modal.querySelector('.secondary-btn');
    if (closeBtn) closeBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
    
    // 모달 헤더에 필수 변경 안내 추가
    const modalTitle = modal.querySelector('h4');
    if (modalTitle) {
      modalTitle.innerHTML = '비밀번호 변경 (필수) 🔐';
      modalTitle.style.color = '#dc3545';
    }
  }
};

// 비밀번호 변경 저장
window.savePassword = async function() {
  const currentPassword = document.getElementById('current-password').value;
  const newPassword = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;

  if (!currentPassword || !newPassword || !confirmPassword) {
    alert('모든 필드를 입력해주세요.');
    return;
  }

  if (newPassword !== confirmPassword) {
    alert('새 비밀번호가 일치하지 않습니다.');
    return;
  }

  if (newPassword.length < 4) {
    alert('비밀번호는 4자리 이상이어야 합니다.');
    return;
  }

  try {
    const changeManagerPassword = httpsCallable(functions, 'changeManagerPassword');
    await changeManagerPassword({
      managerId: currentManager.id,
      currentPassword,
      newPassword
    });

    // 초기 비밀번호 사용자였다면 특별 메시지
    const wasInitialPassword = document.getElementById('manager-password').value === '0000';
    
    closePasswordModal();
    
    if (wasInitialPassword) {
      alert('✅ 비밀번호가 성공적으로 변경되었습니다!\n이제 안전하게 서비스를 이용하실 수 있습니다.');
      
      // 비밀번호 입력란 초기화
      document.getElementById('manager-password').value = '';
    } else {
      alert('비밀번호가 변경되었습니다.');
    }
  } catch (error) {
    console.error('비밀번호 변경 실패:', error);
    let errorMessage = '비밀번호 변경에 실패했습니다.';
    
    if (error.code === 'functions/permission-denied') {
      errorMessage = '현재 비밀번호가 일치하지 않습니다.';
    }
    
    alert(errorMessage);
  }
};

// 보험사 계정 수정
window.editInsuranceAccount = function(companyKey, companyName) {
  currentInsuranceCompany = companyKey;
  const modal = document.getElementById('insuranceModal');
  const title = document.getElementById('insurance-modal-title');
  const companyInput = document.getElementById('insurance-company');
  const employeeIdInput = document.getElementById('insurance-employee-id');
  const passwordInput = document.getElementById('insurance-password');

  title.textContent = `${companyName} 계정 정보`;
  companyInput.value = companyName;

  const account = currentManager?.insuranceAccounts?.[companyKey];
  employeeIdInput.value = account?.employeeId || '';
  passwordInput.value = ''; // 보안상 기존 비밀번호는 표시하지 않음

  modal.style.display = 'block';
};

// 보험사 계정 저장
window.saveInsuranceAccount = async function() {
  if (!currentInsuranceCompany) return;

  const employeeId = document.getElementById('insurance-employee-id').value.trim();
  const password = document.getElementById('insurance-password').value.trim();

  try {
    const updatedAccounts = {
      ...currentManager.insuranceAccounts,
      [currentInsuranceCompany]: {
        employeeId,
        password
      }
    };

    // Firestore 업데이트 (Functions를 통해 암호화)
    const updateManagerInfo = httpsCallable(functions, 'updateManagerInfo');
    await updateManagerInfo({
      managerId: currentManager.id,
      insuranceAccounts: updatedAccounts
    });

    // 로컬 데이터 업데이트
    currentManager.insuranceAccounts = updatedAccounts;
    
    // UI 업데이트
    loadInsuranceAccounts();

    closeInsuranceModal();
    alert('보험사 계정 정보가 저장되었습니다.');
  } catch (error) {
    console.error('보험사 계정 저장 실패:', error);
    alert('보험사 계정 정보 저장에 실패했습니다.');
  }
};

// 모달 닫기 함수들
window.closeEditModal = function() {
  document.getElementById('editModal').style.display = 'none';
  currentEditField = null;
};

window.closePasswordModal = function() {
  // 초기 비밀번호 사용자는 비밀번호 변경 완료 전까지 모달을 닫을 수 없음
  const isInitialPassword = document.getElementById('manager-password').value === '0000';
  if (isInitialPassword) {
    alert('🔐 보안을 위해 비밀번호 변경을 완료해주세요.\n변경 후에 서비스를 이용하실 수 있습니다.');
    return;
  }
  
  const modal = document.getElementById('passwordModal');
  modal.style.display = 'none';
  
  // 필드 초기화
  document.getElementById('current-password').value = '';
  document.getElementById('new-password').value = '';
  document.getElementById('confirm-password').value = '';
  
  // 모달 상태 초기화 (일반 사용자용)
  const closeBtn = modal.querySelector('.close');
  const cancelBtn = modal.querySelector('.secondary-btn');
  const modalTitle = modal.querySelector('h4');
  
  if (closeBtn) closeBtn.style.display = '';
  if (cancelBtn) cancelBtn.style.display = '';
  if (modalTitle) {
    modalTitle.innerHTML = '비밀번호 변경';
    modalTitle.style.color = '';
  }
};

window.closeClientModal = function() {
  document.getElementById('clientModal').style.display = 'none';
  // 수정 모드 상태 초기화
  isEditingClient = false;
  currentEditingClient = null;
};

// 섹션별 수정 모드
let currentEditingSection = null;

// 섹션별 편집 함수
window.editSection = function(sectionName) {
  if (currentEditingSection === sectionName) {
    // 이미 편집 중인 섹션이면 저장
    saveSectionChanges(sectionName);
  } else {
    // 다른 섹션 편집 중이면 먼저 저장
    if (currentEditingSection) {
      saveSectionChanges(currentEditingSection);
    }
    // 새 섹션 편집 시작
    startEditingSection(sectionName);
  }
};

// 섹션 편집 시작
function startEditingSection(sectionName) {
  currentEditingSection = sectionName;
  
  // 버튼 텍스트 변경
  const button = document.querySelector(`[data-section="${sectionName}"]`);
  if (button) {
    button.innerHTML = '<i class="fas fa-save"></i> 저장';
    button.classList.add('editing');
  }
  
  // 해당 섹션 필드들을 편집 가능하게 변경
  convertSectionToEditable(sectionName);
}

// 섹션 편집 완료
function finishEditingSection(sectionName) {
  currentEditingSection = null;
  
  // 버튼 텍스트 복원
  const button = document.querySelector(`[data-section="${sectionName}"]`);
  if (button) {
    button.innerHTML = '<i class="fas fa-edit"></i> 수정';
    button.classList.remove('editing');
  }
}

// 섹션별 편집 가능한 필드로 변환
function convertSectionToEditable(sectionName) {
  if (!currentEditingClient) return;
  
  switch (sectionName) {
    case 'contact':
      convertFieldToEditable('phoneCarrier', 'select', ['', 'SKT', 'KT', 'LG U+', 'SKT알뜰', 'KT알뜰', 'LG알뜰']);
      convertFieldToEditable('phone', 'tel');
      convertFieldToEditable('areaCode', 'select', ['', '02', '031', '032', '033', '041', '042', '043', '044', '051', '052', '053', '054', '055', '061', '062', '063', '064', '070']);
      convertFieldToEditable('companyPhone', 'tel');
      break;
    case 'address':
      convertFieldToEditable('postcode', 'text');
      convertFieldToEditable('address', 'text');
      convertFieldToEditable('addressDetail', 'text');
      break;
    case 'job':
      convertFieldToEditable('occupation', 'text');
      convertFieldToEditable('jobDetail', 'text');
      convertFieldToEditable('employeeCount', 'number');
      break;
    case 'body':
      convertFieldToEditable('height', 'number');
      convertFieldToEditable('weight', 'number');
      convertFieldToEditable('driving', 'select', ['', 'yes', 'no'], ['선택해주세요', '예', '아니오']);
      break;
    case 'medical':
      convertFieldToTextarea('medicalHistory');
      break;
    case 'memo':
      convertFieldToTextarea('memo');
      break;
  }
}

// 필드를 편집 가능한 입력 필드로 변환
function convertFieldToEditable(fieldName, inputType, options = null, optionLabels = null) {
  const spans = document.querySelectorAll(`[data-field="${fieldName}"]`);
  spans.forEach(span => {
    let currentValue = currentEditingClient[fieldName] || '';
    
    // 숫자 필드에서 단위 제거 (편집 시)
    if (['height', 'weight', 'employeeCount'].includes(fieldName)) {
      currentValue = currentValue.toString().replace(/[^0-9]/g, '');
    }
    
    if (inputType === 'select' && options) {
      const select = document.createElement('select');
      select.className = 'editable-field';
      select.setAttribute('data-field', fieldName);
      
      options.forEach((option, index) => {
        const optionElement = document.createElement('option');
        optionElement.value = option;
        optionElement.textContent = optionLabels ? optionLabels[index] : option;
        if (option === currentValue) {
          optionElement.selected = true;
        }
        select.appendChild(optionElement);
      });
      
      span.parentNode.replaceChild(select, span);
    } else if (fieldName === 'postcode') {
      // 우편번호 필드는 특별 처리 - 검색 버튼 포함
      const container = document.createElement('div');
      container.style.display = 'flex';
      container.style.gap = '8px';
      container.style.alignItems = 'center';
      
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'editable-field';
      input.setAttribute('data-field', fieldName);
      input.value = currentValue;
      input.readOnly = true;
      input.style.flex = '1';
      
      const searchBtn = document.createElement('button');
      searchBtn.type = 'button';
      searchBtn.textContent = '검색';
      searchBtn.className = 'primary-btn';
      searchBtn.style.padding = '8px 12px';
      searchBtn.style.fontSize = '12px';
      searchBtn.onclick = () => openPostcodeSearch();
      
      container.appendChild(input);
      container.appendChild(searchBtn);
      span.parentNode.replaceChild(container, span);
    } else {
      const input = document.createElement('input');
      input.type = inputType;
      input.className = 'editable-field';
      input.setAttribute('data-field', fieldName);
      input.value = currentValue;
      
      if (inputType === 'tel') {
        input.pattern = '[0-9]*';
      }
      
      span.parentNode.replaceChild(input, span);
    }
  });
}

// 텍스트 영역을 편집 가능한 textarea로 변환
function convertFieldToTextarea(fieldName) {
  const divs = document.querySelectorAll(`[data-field="${fieldName}"]`);
  divs.forEach(div => {
    const currentValue = currentEditingClient[fieldName] || '';
    
    const textarea = document.createElement('textarea');
    textarea.className = 'editable-textarea';
    textarea.setAttribute('data-field', fieldName);
    textarea.value = currentValue;
    textarea.rows = 4;
    
    div.parentNode.replaceChild(textarea, div);
  });
}

// 섹션별 변경 사항 저장
async function saveSectionChanges(sectionName) {
  try {
    const updatedData = {};
    
    // 해당 섹션의 편집 가능한 필드에서 값 수집
    const editableFields = document.querySelectorAll('.editable-field, .editable-textarea');
    editableFields.forEach(field => {
      const fieldName = field.getAttribute('data-field');
      let value = field.value.trim();
      
      // 숫자 필드에서 단위 제거 (키, 몸무게, 직원수)
      if (['height', 'weight', 'employeeCount'].includes(fieldName)) {
        value = value.replace(/[^0-9]/g, '');
      }
      
      updatedData[fieldName] = value;
    });
    
    // Firestore에 업데이트
    const clientRef = doc(db, 'client_info', currentEditingClient.id);
    await updateDoc(clientRef, {
      ...updatedData,
      updated_at: new Date()
    });
    
    // 로컬 데이터 업데이트
    Object.assign(currentEditingClient, updatedData);
    
    // 고객 목록도 업데이트
    const clientIndex = currentClients.findIndex(c => c.id === currentEditingClient.id);
    if (clientIndex !== -1) {
      Object.assign(currentClients[clientIndex], updatedData);
    }
    
    // 섹션 편집 완료
    finishEditingSection(sectionName);
    
    // 해당 섹션을 보기 모드로 복원
    showClientDetail(currentEditingClient.id);
    
  } catch (error) {
    console.error('고객 정보 수정 실패:', error);
    alert('고객 정보 수정에 실패했습니다. 다시 시도해주세요.');
  }
}

window.closeInsuranceModal = function() {
  document.getElementById('insuranceModal').style.display = 'none';
  currentInsuranceCompany = null;
};

// DOM 로드 후 초기화
document.addEventListener('DOMContentLoaded', function() {
  // 모바일 햄버거 메뉴 이벤트
  const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  
  if (mobileMenuToggle) {
    mobileMenuToggle.addEventListener('click', function() {
      toggleMobileMenu();
    });
  }
  
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', function() {
      closeMobileMenu();
    });
  }

  // 사이드바 메뉴 클릭 이벤트
  document.getElementById('menu-profile').addEventListener('click', function() {
    showSection('profile-section');
    setActiveMenu('menu-profile');
    closeMobileMenu(); // 모바일에서 메뉴 선택 시 사이드바 닫기
  });

  document.getElementById('menu-clients').addEventListener('click', function() {
    showSection('clients-section');
    setActiveMenu('menu-clients');
    closeMobileMenu(); // 모바일에서 메뉴 선택 시 사이드바 닫기
  });

  document.getElementById('menu-insurance').addEventListener('click', function() {
    showSection('insurance-section');
    setActiveMenu('menu-insurance');
    closeMobileMenu(); // 모바일에서 메뉴 선택 시 사이드바 닫기
  });

  // 고객 검색
  const clientSearch = document.getElementById('client-search');
  if (clientSearch) {
    clientSearch.addEventListener('input', function(e) {
      renderClientList(e.target.value.trim());
    });
  }

  const clientSearchReset = document.getElementById('client-search-reset');
  if (clientSearchReset) {
    clientSearchReset.addEventListener('click', function() {
      clientSearch.value = '';
      renderClientList();
    });
  }

  // 모달 외부 클릭 시 닫기
  window.addEventListener('click', function(e) {
    const modals = ['editModal', 'passwordModal', 'clientModal', 'insuranceModal'];
    modals.forEach(modalId => {
      const modal = document.getElementById(modalId);
      if (e.target === modal) {
        modal.style.display = 'none';
        // 고객 모달인 경우 추가 정리
        if (modalId === 'clientModal') {
          closeClientModal();
        }
      }
    });
  });

  // ESC 키로 모달 닫기
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      // 열려있는 모달 찾기
      const modals = ['editModal', 'passwordModal', 'clientModal', 'insuranceModal'];
      modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal && modal.style.display === 'block') {
          modal.style.display = 'none';
          // 각 모달별 닫기 함수 호출
          if (modalId === 'editModal') closeEditModal();
          else if (modalId === 'passwordModal') closePasswordModal();
          else if (modalId === 'clientModal') closeClientModal();
          else if (modalId === 'insuranceModal') closeInsuranceModal();
        }
      });
    }
  });

  // 카테고리 헤더는 이제 아코디언이 아니므로 관련 이벤트 리스너 제거

  // Enter 키 이벤트
  document.getElementById('manager-password').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      login();
    }
  });

  // 윈도우 리사이즈 이벤트 - 햄버거 버튼 표시/숨김 조정
  window.addEventListener('resize', function() {
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    if (mobileMenuToggle && currentManager) { // 로그인된 상태에서만
      if (window.innerWidth <= 768) {
        mobileMenuToggle.style.display = 'flex';
      } else {
        mobileMenuToggle.style.display = 'none';
        closeMobileMenu(); // 데스크톱 크기로 변경 시 메뉴 닫기
      }
    }
  });
});

// 섹션 표시 함수
function showSection(sectionId) {
  document.querySelectorAll('.content-section').forEach(section => {
    section.style.display = 'none';
  });
  document.getElementById(sectionId).style.display = 'block';
}

// 활성 메뉴 설정
function setActiveMenu(menuId) {
  document.querySelectorAll('.sidebar-menu li').forEach(item => {
    item.classList.remove('active');
  });
  document.getElementById(menuId).classList.add('active');
}

// 모바일 메뉴 토글
function toggleMobileMenu() {
  const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  
  if (sidebar.classList.contains('open')) {
    closeMobileMenu();
  } else {
    openMobileMenu();
  }
}

// 모바일 메뉴 열기
function openMobileMenu() {
  const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  
  mobileMenuToggle.classList.add('active');
  sidebar.classList.add('open');
  sidebarOverlay.style.display = 'block';
  
  // 바디 스크롤 방지
  document.body.style.overflow = 'hidden';
}

// 모바일 메뉴 닫기
function closeMobileMenu() {
  const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  
  mobileMenuToggle.classList.remove('active');
  sidebar.classList.remove('open');
  sidebarOverlay.style.display = 'none';
  
  // 바디 스크롤 복원
  document.body.style.overflow = '';
}

// 우편번호 검색 팝업 열기
window.openPostcodeSearch = function openPostcodeSearch() {
  new daum.Postcode({
    oncomplete: function(data) {
      // 우편번호와 주소 정보를 가져옴
      let addr = ''; // 주소 변수
      let extraAddr = ''; // 참고항목 변수

      // 사용자가 선택한 주소 타입에 따라 해당 주소 값을 가져온다.
      if (data.userSelectedType === 'R') { // 도로명 주소
        addr = data.roadAddress;
      } else { // 지번 주소
        addr = data.jibunAddress;
      }

      // 도로명 주소일 때 참고항목을 조합한다.
      if(data.userSelectedType === 'R'){
        // 법정동명이 있을 때 추가한다. (법정리는 제외)
        if(data.bname !== '' && /[동|로|가]$/g.test(data.bname)){
          extraAddr += data.bname;
        }
        // 건물명이 있고, 공동주택일 때 추가한다.
        if(data.buildingName !== '' && data.apartment === 'Y'){
          extraAddr += (extraAddr !== '' ? ', ' + data.buildingName : data.buildingName);
        }
        // 표시할 참고항목이 있을 때, 괄호까지 추가한 최종 문자열을 만든다.
        if(extraAddr !== ''){
          extraAddr = ' (' + extraAddr + ')';
        }
      }

      // 우편번호와 주소 정보를 해당 필드에 넣는다.
      const postcodeField = document.querySelector('[data-field="postcode"]');
      const addressField = document.querySelector('[data-field="address"]');
      
      if (postcodeField) {
        postcodeField.value = data.zonecode;
      }
      
      if (addressField) {
        addressField.value = addr + extraAddr;
      }
      
      // 상세주소 필드로 포커스 이동 (있는 경우)
      const addressDetailField = document.querySelector('[data-field="addressDetail"]');
      if (addressDetailField) {
        addressDetailField.focus();
      }
    }
  }).open();
};

// 비밀번호 초기화 함수
window.resetPassword = async function() {
  const code = document.getElementById('manager-code').value.trim();
  
  if (!code) {
    alert('담당자 코드를 입력해주세요.');
    return;
  }
  
  if (!confirm('비밀번호를 초기화하시겠습니까?\n\n초기화 후 비밀번호: 0000\n이 비밀번호로 로그인 후 새로운 비밀번호로 변경해주세요.')) {
    return;
  }
  
  try {
    // 담당자 코드로 담당자 찾기
    const managersQuery = query(collection(db, 'managers'), where('code', '==', code));
    const managersSnapshot = await getDocs(managersQuery);
    
    if (managersSnapshot.empty) {
      alert('존재하지 않는 담당자 코드입니다.');
      return;
    }
    
    const managerDoc = managersSnapshot.docs[0];
    const managerId = managerDoc.id;
    
    // Firebase Functions 호출 (담당자 본인이 초기화)
    const setManagerPassword = httpsCallable(functions, 'setManagerPassword');
    await setManagerPassword({
      managerId: managerId,
      password: '0000'
    });
    
    alert('✅ 비밀번호가 초기화되었습니다.\n\n새 비밀번호: 0000\n\n이 비밀번호로 로그인 후 새로운 비밀번호로 변경해주세요.');
    
    // 비밀번호 입력란에 0000 입력
    document.getElementById('manager-password').value = '0000';
    
  } catch (error) {
    console.error('비밀번호 초기화 실패:', error);
    let errorMessage = '비밀번호 초기화에 실패했습니다.';
    
    if (error.code === 'functions/permission-denied') {
      errorMessage = '비밀번호 초기화 권한이 없습니다.';
    } else if (error.code === 'functions/not-found') {
      errorMessage = '존재하지 않는 담당자입니다.';
    }
    
    alert(`❌ ${errorMessage}\n\n${error.message || error}`);
  }
};