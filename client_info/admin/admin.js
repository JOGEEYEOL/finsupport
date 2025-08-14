import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-auth.js";
import { collection, getDocs, query, where, doc, getDoc, updateDoc, collection as fsCollection, addDoc, deleteDoc, onSnapshot, orderBy, Timestamp, limit, startAfter } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-firestore.js";
import { ref, deleteObject } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-storage.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-functions.js";
import { db } from "../common/config/database.js";
import { 
  lifeInsuranceCompanies, 
  nonLifeInsuranceCompanies, 
  insuranceCompanies, 
  lifeCompanies, 
  nonLifeCompanies,
  getInsuranceCompanyKey,
  getInsuranceCompanyName,
  getInsuranceCompanyType
} from "../common/config/insurance-companies.js";
import { ExamScheduleUI } from "../common/js/components/exam-schedule-ui.js";
import { autoMoveToNext, handlePhoneBackspace, StringUtils } from "../common/js/utils/helpers.js";
import { showConfirmDialog, showAlert } from "../common/js/components/modal-manager.js";
import { PaginationManager } from "../common/js/components/pagination.js";
import { auth, storage, functions } from "../common/js/core/firebase-config.js";

// 서버 사이드 복호화 함수
async function decryptSSN(ciphertext) {
  try {
    if (!ciphertext || typeof ciphertext !== 'string' || ciphertext.trim() === '') {
      return "";
    }
    
    // 현재 로그인된 사용자 정보 확인
    const currentUser = auth.currentUser;
    
    if (!currentUser) {
      return "로그인이 필요합니다.";
    }
    
    // Firebase Functions 호출
    const decryptSSNFunction = httpsCallable(functions, 'decryptSSN');
    const requestData = { ssn: ciphertext };
    
    // 인증 토큰을 새로고침하여 최신 상태로 만들기
    await currentUser.getIdToken(true);
    
    const result = await decryptSSNFunction(requestData);
    
    return result.data.ssn || "복호화 실패";
  } catch (e) {
    console.error("복호화 중 에러 발생:", e);
    return "복호화 실패";
  }
}

let allClients = [];
let pagedClients = [];
let lastVisible = null;
let isLoadingClients = false;
const PAGE_SIZE = 5; // 5개씩 표시하도록 변경

// 페이지네이션 매니저 인스턴스
let clientPagination;
let managerPagination;

// 페이지네이션 상수 및 변수
const ITEMS_PER_PAGE = 5;
let currentClientPage = 0;
let currentManagerPage = 0;
let displayedManagers = [];

// DOM 요소 접근을 위한 변수들
let searchInput, cardList, detailModal, detailContent, closeModal;

// 허용된 관리자 이메일 목록
const allowedAdmins = [
  'geese3433@gmail.com',  // 기존 관리자
  'iqhali93@gmail.com',
  "offbeatt@naver.com",
];

// 보험사 목록은 insurance-companies.js 모듈에서 import됩니다

// Firestore managers 컬렉션 연동
let managers = [];

// 담당자별 복호화 캐시 (전역)
let managerDecryptionCache = {};

// Firebase Storage는 firebase-config.js에서 초기화됨

// 마이그레이션 모드 체크 함수
async function checkMigrationMode() {
  try {
    // 인증 토큰 새로고침
    const currentUser = auth.currentUser;
    if (currentUser) {
      await currentUser.getIdToken(true);
    }
    
    const getMigrationModeFunction = httpsCallable(functions, 'getMigrationMode');
    const result = await getMigrationModeFunction();
    return result.data.migrationMode;
  } catch (error) {
    // 마이그레이션 모드 체크 에러 (로그 제거)
    return false; // 에러 시 기본적으로 숨김
  }
}

// 마이그레이션 버튼 표시/숨김 함수
async function toggleMigrationButton() {
  const migrateBtn = document.getElementById('migrateBtn');
  if (!migrateBtn) return;
  
  const migrationMode = await checkMigrationMode();
  migrateBtn.style.display = migrationMode ? 'inline-block' : 'none';
  
  if (migrationMode) {
    // 마이그레이션 모드 활성화됨
  }
}

// 마이그레이션 함수 (전역 함수로 등록)
window.runMigration = async function() {
  showConfirmDialog(
    "주의: 모든 주민등록번호를 새 암호화키로 마이그레이션합니다.\n\n이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?",
    async () => {
      await executeMigration();
    }
  );
};

// 마이그레이션 실행 함수 분리
async function executeMigration() {
  
  try {
    const migrateBtn = document.getElementById('migrateBtn');
    migrateBtn.disabled = true;
    migrateBtn.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> 마이그레이션 진행 중...';
    
    // 인증 토큰 새로고침
    const currentUser = auth.currentUser;
    if (currentUser) {
      await currentUser.getIdToken(true);
    }
    
    const migrateFunction = httpsCallable(functions, 'migrateSSNEncryption');
    const result = await migrateFunction();
    
    const resultData = result.data;
    showAlert(`마이그레이션 완료!\n\n` +
             `총 문서: ${resultData.total}\n` +
             `성공: ${resultData.success}\n` +
             `실패: ${resultData.fail}\n` +
             `건너뜀: ${resultData.skipped}\n\n` +
             `${resultData.message}`);
    
  } catch (error) {
    console.error('마이그레이션 에러:', error);
    showAlert(`마이그레이션 실패!\n\n에러: ${error.message || error}`);
  } finally {
    const migrateBtn = document.getElementById('migrateBtn');
    migrateBtn.disabled = false;
    migrateBtn.innerHTML = '<i class="fas fa-sync-alt"></i> 주민등록번호 암호화 마이그레이션';
  }
};

// 고객 데이터 로딩 함수
async function loadClients() {
  try {
    const snapshot = await getDocs(fsCollection(db, 'client_info'));
    allClients = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    renderCards(allClients, true);
  } catch (error) {
    console.error('고객 데이터 로딩 실패:', error);
  }
}

// 담당자 데이터 로딩 함수
async function loadManagers() {
  try {
    await fetchManagers();
    renderManagerCards(managers, true);
  } catch (error) {
    console.error('담당자 데이터 로딩 실패:', error);
  }
}

async function fetchManagers() {
  // createdAt 기준으로 정렬하여 조회
  const q = query(fsCollection(db, 'managers'), orderBy('createdAt', 'asc'));
  const snapshot = await getDocs(q);
  managers = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data() // 모든 필드를 포함
  }));
  updateManagersList();
}

function listenManagers() {
  // 실시간 반영 + 등록순 정렬
  const q = query(fsCollection(db, 'managers'), orderBy('createdAt', 'asc'));
  onSnapshot(q, (snapshot) => {
    managers = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data() // 모든 필드를 포함
    }));
    updateManagersList();
  });
}

function updateManagersList() {
  const managersList = document.getElementById('managerList');
  if (!managersList) return;
  managersList.innerHTML = managers.map((m, index) => {
    // 담당자 URL 생성 (실제 서비스 도메인 사용, 쿼리스트링만)
    const url = `https://owners-client.info/index.html?manager=${m.code || ''}`;
    return `<div class=\"manager-item\" data-id=\"${m.id}\">\n      <span class=\"manager-name\" data-index=\"${index}\">${m.name}</span>\n      <span class=\"manager-url\" style=\"margin-left:8px; font-size:12px; color:#3498db; cursor:pointer; text-decoration:underline;\" data-url=\"${url}\">${m.code ? '링크' : ''}</span>\n      <button class=\"edit-manager\" data-id=\"${m.id}\">수정</button>\n      <button class=\"delete-manager\" data-id=\"${m.id}\">삭제</button>\n    </div>`;
  }).join('');
  // 카드리스트도 새로고침
  renderCards(allClients, true);

  // 담당자 정보 조회 페이지가 활성화되어 있으면 담당자 카드도 업데이트
  const managerInfoSection = document.getElementById('manager-info-section');
  if (managerInfoSection && managerInfoSection.style.display !== 'none') {
    renderManagerCards(managers, true);
  }

  // 링크 클릭 시 복사 이벤트 등록
  document.querySelectorAll('.manager-url').forEach(span => {
    span.addEventListener('click', function() {
      const url = this.dataset.url;
      navigator.clipboard.writeText(url).then(() => {
        const original = this.textContent;
        this.textContent = '복사됨!';
        setTimeout(() => { this.textContent = original; }, 1200);
      });
    });
  });
}

function initManagers() {
  const managersList = document.getElementById('managerList');
  const addManagerBtn = document.getElementById('addManagerBtn');
  const managerInput = document.getElementById('newManager');

  let isAddingManager = false;
  // 담당자 추가 함수 (간단한 버전)
  async function addManager() {
    if (isAddingManager) return;
    
    const name = managerInput.value.trim();
    if (!name) {
      showAlert('담당자 이름을 입력해주세요.');
      return;
    }

    isAddingManager = true;
    
    try {
      // 올해 연도 2자리
      const now = new Date();
      const year = now.getFullYear().toString().slice(-2);
      
      // 올해 생성된 담당자 중 가장 큰 순번 찾기
      const snapshot = await getDocs(fsCollection(db, 'managers'));
      let maxSeq = 0;
      snapshot.forEach(doc => {
        const code = doc.data().code;
        if (code && code.startsWith(`OB${year}`)) {
          const seq = parseInt(code.slice(4), 10);
          if (seq > maxSeq) maxSeq = seq;
        }
      });
      const newSeq = (maxSeq + 1).toString().padStart(3, '0');
      const newCode = `OB${year}${newSeq}`;

      // 기본 담당자 데이터 저장 (기본 비밀번호 0000 포함)
      const defaultPassword = '0000';
      const hashedPassword = window.CryptoJS.SHA256(defaultPassword).toString();
      
      const managerData = {
        code: newCode,
        name: name,
        team: '',
        role: '',
        password: hashedPassword,
        passwordUpdatedAt: Timestamp.now(),
        createdAt: Timestamp.now()
      };

      // 직접 Firestore에 저장
      await addDoc(fsCollection(db, 'managers'), managerData);

      showAlert(`담당자가 성공적으로 추가되었습니다!\n\n담당자 코드: ${newCode}\n기본 비밀번호: 0000\n\n※ 담당자는 기본 비밀번호로 로그인 후 본인이 비밀번호를 변경할 수 있습니다.`);
      managerInput.value = '';
      
    } catch (error) {
      console.error('담당자 추가 실패:', error);
      showAlert('담당자 추가에 실패했습니다: ' + (error.message || error));
    } finally {
      isAddingManager = false;
    }
  }

  // 이벤트 리스너 등록
  addManagerBtn.addEventListener('click', addManager);
  
  // 엔터키로 담당자 추가
  managerInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await addManager();
    }
  });

  // 담당자 수정/삭제 (인라인 수정 UI)
  managersList.addEventListener('click', async (e) => {
    const id = e.target.dataset.id;
    if (e.target.classList.contains('delete-manager')) {
      showConfirmDialog('정말 삭제하시겠습니까?', async () => {
        await deleteDoc(doc(db, 'managers', id));
        await loadManagers();
      });
    } else if (e.target.classList.contains('edit-manager')) {
      const itemDiv = e.target.closest('.manager-item');
      const current = managers.find(m => m.id === id);
      if (!itemDiv || !current) return;
      // 인라인 수정 UI로 변경 (코드 입력란 추가)
      itemDiv.innerHTML = `
        <input type="text" class="edit-manager-input" value="${current.name}" style="padding:6px; border:1px solid #ccc; border-radius:4px; width:120px; margin-right:8px;">
        <input type="text" class="edit-manager-code-input" value="${current.code || ''}" style="padding:6px; border:1px solid #ccc; border-radius:4px; width:90px; margin-right:8px;">
        <button class="edit-manager-confirm" data-id="${id}" style="background:#4CAF50; color:#fff; padding:6px 12px; border-radius:4px; border:none; margin-right:4px;">확인</button>
        <button class="edit-manager-cancel" data-id="${id}" style="background:#ccc; color:#333; padding:6px 12px; border-radius:4px; border:none;">취소</button>
      `;
      // 확인/취소 이벤트
      itemDiv.querySelector('.edit-manager-input').focus();
    } else if (e.target.classList.contains('edit-manager-confirm')) {
      const itemDiv = e.target.closest('.manager-item');
      const input = itemDiv.querySelector('.edit-manager-input');
      const codeInput = itemDiv.querySelector('.edit-manager-code-input');
      const newName = input.value.trim();
      const newCode = codeInput.value.trim();
      if (newName && newCode) {
        await updateDoc(doc(db, 'managers', id), { name: newName, code: newCode });
      }
    } else if (e.target.classList.contains('edit-manager-cancel')) {
      updateManagersList();
    }
  });

  // 항상 최신 managers로 실시간 반영
  listenManagers();
}

// DOM이 로드된 후 실행
document.addEventListener('DOMContentLoaded', () => {
  // DOM 요소 초기화
  searchInput = document.getElementById("searchInput");
  cardList = document.getElementById("cardList");
  detailModal = document.getElementById("detailModal");
  detailContent = document.getElementById("detailContent");
  closeModal = document.getElementById("closeModal");

  // 담당자 정보 조회 관련 DOM 요소
  const managerSearchInput = document.getElementById("managerSearchInput");
  const managerCardList = document.getElementById("managerCardList");

  // 이벤트 리스너 설정
  if (searchInput) {
    searchInput.addEventListener("input", handleSearch);
  }
  
  // 검색 타입 변경 이벤트 리스너
  const searchType = document.getElementById("searchType");
  if (searchType) {
    searchType.addEventListener("change", function() {
      const searchInput = document.getElementById("searchInput");
      if (searchInput) {
        switch (this.value) {
          case 'name':
            searchInput.placeholder = "고객명을 입력하세요";
            break;
          case 'phone':
            searchInput.placeholder = "전화번호를 입력하세요";
            break;
          case 'manager':
            searchInput.placeholder = "담당자명을 입력하세요";
            break;
          case 'all':
          default:
            searchInput.placeholder = "검색어를 입력하세요";
            break;
        }
        // 검색 타입이 변경되면 기존 검색 결과를 다시 필터링
        if (searchInput.value.trim()) {
          handleSearch.call(searchInput);
        }
      }
    });
  }

  // 담당자 검색 이벤트 리스너
  if (managerSearchInput) {
    managerSearchInput.addEventListener("input", handleManagerSearch);
  }
  
  // 담당자 검색 타입 변경 이벤트 리스너
  const managerSearchType = document.getElementById("managerSearchType");
  if (managerSearchType) {
    managerSearchType.addEventListener("change", function() {
      const managerSearchInput = document.getElementById("managerSearchInput");
      if (managerSearchInput) {
        switch (this.value) {
          case 'name':
            managerSearchInput.placeholder = "담당자명을 입력하세요";
            break;
          case 'code':
            managerSearchInput.placeholder = "담당자 코드를 입력하세요";
            break;
          case 'team':
            managerSearchInput.placeholder = "팀명을 입력하세요";
            break;
          case 'all':
          default:
            managerSearchInput.placeholder = "검색어를 입력하세요";
            break;
        }
        // 검색 타입이 변경되면 기존 검색 결과를 다시 필터링
        if (managerSearchInput.value.trim()) {
          handleManagerSearch.call(managerSearchInput);
        }
      }
    });
  }

  if (closeModal) {
    closeModal.onclick = () => {
      detailModal.style.display = "none";
      document.body.classList.remove('modal-open');
    };
  }

  window.onclick = (e) => {
    if (e.target === detailModal) {
      detailModal.style.display = "none";
      document.body.classList.remove('modal-open');
    }
  };

  // 엔터키로 로그인
  const emailInput = document.getElementById('admin-email');
  const passwordInput = document.getElementById('admin-password');
  [emailInput, passwordInput].forEach(input => {
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        login();
      }
    });
  });

  initManagers();

  // 사이드 메뉴 전환 기능
  initMenuSwitch();

  // 검색 초기화 버튼 기능
  const searchResetBtn = document.getElementById('searchResetBtn');
  if (searchResetBtn && searchInput && cardList) {
    searchResetBtn.addEventListener('click', () => {
      searchInput.value = '';
      renderCards(allClients, true); // reset = true로 처음부터 시작
    });
  }

  // 담당자 검색 초기화 버튼 기능
  const managerSearchResetBtn = document.getElementById('managerSearchResetBtn');
  if (managerSearchResetBtn && managerSearchInput && managerCardList) {
    managerSearchResetBtn.addEventListener('click', () => {
      managerSearchInput.value = '';
      renderManagerCards(managers, true); // reset = true로 처음부터 시작
    });
  }

  // 고객 더보기 버튼 이벤트 리스너
  const clientLoadMoreBtn = document.getElementById('clientLoadMoreBtn');
  if (clientLoadMoreBtn) {
    clientLoadMoreBtn.addEventListener('click', () => {
      const keyword = searchInput ? searchInput.value.trim() : '';
      let dataToShow;
      
      if (keyword) {
        // 검색 중일 때
        dataToShow = allClients.filter(
          (client) =>
            (client.name && client.name.includes(keyword)) ||
            (client.phone && client.phone.replace(/-/g, "").includes(keyword.replace(/-/g, ""))) ||
            (client.manager && client.manager.includes(keyword))
        );
      } else {
        // 전체 데이터 표시
        dataToShow = allClients;
      }
      
      renderCards(dataToShow, false); // reset = false로 추가 로딩
    });
  }

  // 페이지네이션 매니저 초기화
  clientPagination = new PaginationManager({
    itemsPerPage: ITEMS_PER_PAGE,
    loadMoreContainerId: 'clientLoadMore',
    loadMoreBtnId: 'clientLoadMoreBtn',
    remainingCountSpanId: 'clientRemainingCount',
    onLoadMore: async () => {
      const keyword = searchInput ? searchInput.value.trim() : '';
      let dataToShow;
      
      if (keyword) {
        dataToShow = allClients.filter(
          (client) =>
            (client.name && client.name.includes(keyword)) ||
            (client.phone && client.phone.replace(/-/g, "").includes(keyword.replace(/-/g, ""))) ||
            (client.manager && client.manager.includes(keyword))
        );
      } else {
        dataToShow = allClients;
      }
      
      renderCards(dataToShow, false);
    }
  });

  managerPagination = new PaginationManager({
    itemsPerPage: ITEMS_PER_PAGE,
    loadMoreContainerId: 'managerLoadMore',
    loadMoreBtnId: 'managerLoadMoreBtn',
    remainingCountSpanId: 'managerRemainingCount',
    onLoadMore: async () => {
      const managerSearchInput = document.getElementById('managerSearchInput');
      const keyword = managerSearchInput ? managerSearchInput.value.trim() : '';
      
      let dataToShow;
      if (keyword) {
        dataToShow = managers.filter(manager => 
          (manager.name && manager.name.includes(keyword)) ||
          (manager.code && manager.code.includes(keyword)) ||
          (manager.team && manager.team.includes(keyword))
        );
      } else {
        dataToShow = managers;
      }
      
      renderManagerCards(dataToShow, false);
    }
  });

  // 담당자 더보기 버튼 이벤트 리스너 (기존 코드 유지)
  const managerLoadMoreBtn = document.getElementById('managerLoadMoreBtn');
  if (managerLoadMoreBtn) {
    managerLoadMoreBtn.addEventListener('click', () => {
      const managerSearchInput = document.getElementById('managerSearchInput');
      const keyword = managerSearchInput ? managerSearchInput.value.trim() : '';
      let dataToShow;
      
      if (keyword) {
        // 검색 중일 때
        dataToShow = managers.filter(
          (manager) =>
            (manager.name && manager.name.includes(keyword)) ||
            (manager.code && manager.code.toLowerCase().includes(keyword.toLowerCase())) ||
            (manager.team && manager.team.includes(keyword)) ||
            (manager.role && manager.role.includes(keyword))
        );
      } else {
        // 전체 데이터 표시
        dataToShow = managers;
      }
      
      renderManagerCards(dataToShow, false); // reset = false로 추가 로딩
    });
  }

  // 햄버거 메뉴 토글 (모바일)
  const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  
  if (mobileMenuToggle && sidebar) {
    mobileMenuToggle.addEventListener('click', () => {
      mobileMenuToggle.classList.toggle('active');
      sidebar.classList.toggle('open');
      if (sidebarOverlay) {
        sidebarOverlay.style.display = sidebar.classList.contains('open') ? 'block' : 'none';
      }
    });
  }
  
  // 오버레이 클릭 시 사이드바 닫기
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', () => {
      mobileMenuToggle.classList.remove('active');
      sidebar.classList.remove('open');
      sidebarOverlay.style.display = 'none';
    });
  }
});

// 검색 처리 함수 (검색 타입에 따라 분류)
function handleSearch() {
  const keyword = this.value.trim();
  const searchType = document.getElementById('searchType').value;
  
  if (!keyword) {
    renderCards(allClients, true); // reset = true로 처음부터 시작
    return;
  }
  
  let filtered;
  switch (searchType) {
    case 'name':
      filtered = allClients.filter(client => 
        client.name && client.name.includes(keyword)
      );
      break;
    case 'phone':
      filtered = allClients.filter(client => 
        client.phone && client.phone.replace(/-/g, "").includes(keyword.replace(/-/g, ""))
      );
      break;
    case 'manager':
      filtered = allClients.filter(client => 
        client.manager && client.manager.includes(keyword)
      );
      break;
    case 'all':
    default:
      filtered = allClients.filter(client =>
        (client.name && client.name.includes(keyword)) ||
        (client.phone && client.phone.replace(/-/g, "").includes(keyword.replace(/-/g, ""))) ||
        (client.manager && client.manager.includes(keyword))
      );
      break;
  }
  
  renderCards(filtered, true); // reset = true로 처음부터 시작
}

// 담당자 검색 처리 함수 (검색 타입에 따라 분류)
function handleManagerSearch() {
  const keyword = this.value.trim();
  const searchType = document.getElementById('managerSearchType').value;
  
  if (!keyword) {
    renderManagerCards(managers, true); // reset = true로 처음부터 시작
    return;
  }
  
  let filtered;
  switch (searchType) {
    case 'name':
      filtered = managers.filter(manager => 
        manager.name && manager.name.includes(keyword)
      );
      break;
    case 'code':
      filtered = managers.filter(manager => 
        manager.code && manager.code.toLowerCase().includes(keyword.toLowerCase())
      );
      break;
    case 'team':
      filtered = managers.filter(manager => 
        manager.team && manager.team.includes(keyword)
      );
      break;
    case 'all':
    default:
      filtered = managers.filter(manager =>
        (manager.name && manager.name.includes(keyword)) ||
        (manager.code && manager.code.toLowerCase().includes(keyword.toLowerCase())) ||
        (manager.team && manager.team.includes(keyword)) ||
        (manager.role && manager.role.includes(keyword))
      );
      break;
  }
  
  renderManagerCards(filtered, true); // reset = true로 처음부터 시작
}

// 로그인/로그아웃 시 body에 login-mode 클래스 토글
function setLoginMode(isLogin) {
  if (isLogin) {
    document.body.classList.remove('login-mode');
    document.querySelector('.admin-flex').style.display = '';
    document.getElementById('login-form').style.display = 'none';
  } else {
    document.body.classList.add('login-mode');
    document.querySelector('.admin-flex').style.display = 'none';
    document.getElementById('login-form').style.display = '';
  }
}

// 로그인 함수를 전역으로 노출
window.login = async function () {
  const email = document.getElementById("admin-email").value;
  const password = document.getElementById("admin-password").value;
  
  try {
    if (!email || !password) {
      throw new Error("이메일과 비밀번호를 모두 입력해주세요.");
    }
    
    // 로그인 시도
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    
    // 로그인 후 인증 상태 확인
    const currentUser = auth.currentUser;
    
    if (!currentUser) {
      throw new Error("로그인 후에도 사용자 정보를 가져올 수 없습니다.");
    }
    
    // 허용된 관리자인지 확인
    if (!allowedAdmins.includes(currentUser.email)) {
      await signOut(auth);
      throw new Error("관리자 계정이 아닙니다.");
    }
    
    // 토큰 새로고침
    await currentUser.getIdToken(true);
    
    document.getElementById("login-form").style.display = "none";
    document.getElementById("admin-content").style.display = "block";
    setLoginMode(true);
    loadAdminData();
    listenManagers();
  } catch (error) {
    console.error("로그인 실패 상세:", error);
    
    // 에러 메시지 개선
    let errorMessage = "로그인에 실패했습니다. ";
    switch (error.code) {
      case 'auth/invalid-credential':
        errorMessage += "이메일 또는 비밀번호가 올바르지 않습니다. Firebase 콘솔에서 계정을 다시 확인해주세요.";
        break;
      case 'auth/user-not-found':
        errorMessage += "등록되지 않은 이메일입니다. Firebase 콘솔에서 계정을 생성해주세요.";
        break;
      case 'auth/wrong-password':
        errorMessage += "비밀번호가 올바르지 않습니다. Firebase 콘솔에서 비밀번호를 확인해주세요.";
        break;
      case 'auth/invalid-email':
        errorMessage += "올바른 이메일 형식이 아닙니다.";
        break;
      case 'auth/user-disabled':
        errorMessage += "비활성화된 계정입니다. Firebase 콘솔에서 계정 상태를 확인해주세요.";
        break;
      default:
        errorMessage += error.message;
    }
    
    showAlert(errorMessage);
    
    // 로그인 실패 시 입력 필드 초기화
    document.getElementById("admin-password").value = "";
    setLoginMode(false);
  }
};

// 로그아웃 함수도 전역으로 노출
window.logout = function () {
  signOut(auth).then(() => {
    // 검색어 초기화
    if (searchInput) {
      searchInput.value = '';
    }
    // 카드 리스트 초기화
    if (cardList) {
      cardList.innerHTML = '<div class="search-guide">검색어를 입력하세요.</div>';
    }
    managers = [];
    updateManagersList();
    setLoginMode(false);
  });
};

// 인증 상태 변경 감지
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      // 토큰 새로고침
      const token = await user.getIdToken(true);
      
      // 허용된 관리자인지 확인
      if (allowedAdmins.includes(user.email)) {
        document.getElementById("login-form").style.display = "none";
        document.getElementById("admin-content").style.display = "block";
        setLoginMode(true);
        loadAdminData();
        listenManagers();
      } else {
        await signOut(auth);
        document.getElementById("login-form").style.display = "block";
        document.getElementById("admin-content").style.display = "none";
        setLoginMode(false);
      }
    } catch (error) {
      console.error("토큰 새로고침 실패:", error);
      setLoginMode(false);
    }
  } else {
    document.getElementById("login-form").style.display = "block";
    document.getElementById("admin-content").style.display = "none";
    setLoginMode(false);
  }
});

// 관리자 데이터 로드
function loadAdminData() {
  listenClients();
  // 마이그레이션 버튼 표시/숨김 체크
  toggleMigrationButton();
  
  // 필요한 컴포넌트 초기화 (섹션별로)
  setTimeout(() => {
    initializeCurrentSection();
  }, 100);
}

// 현재 활성화된 섹션에 따라 필요한 초기화 수행
function initializeCurrentSection() {
  const savedSection = localStorage.getItem("adminActiveSection") || "managers";
  
  switch (savedSection) {
    case "manager-info":
      if (typeof renderManagerCards === 'function' && typeof managers !== 'undefined') {
        renderManagerCards(managers, true);
      }
      break;
    case "clients":
      if (typeof renderCards === 'function' && typeof allClients !== 'undefined') {
        renderCards(allClients, true);
      }
      break;
    case "exam-schedule":
      if (typeof initializeExamSchedule === 'function') {
        initializeExamSchedule();
      }
      break;
    case "applicants":
      if (typeof initializeApplicantViewer === 'function') {
        initializeApplicantViewer();
      }
      break;
  }
}

// 고객 카드 페이지네이션 렌더링
function renderCards(data, reset = true) {
  if (!cardList) return;
  if (!data || data.length === 0) {
    cardList.innerHTML = '<div class="search-guide">등록된 고객 정보가 없습니다.</div>';
    updateClientLoadMoreButton([], 0);
    return;
  }
  
  if (reset) {
    currentClientPage = 0;
    pagedClients = [];
    cardList.innerHTML = "";
  }
  
  // 현재 페이지에 표시할 데이터 계산
  const startIndex = currentClientPage * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentPageData = data.slice(startIndex, endIndex);
  
  // 새로운 데이터를 pagedClients에 추가
  pagedClients = pagedClients.concat(currentPageData);
  
  // 현재 페이지 데이터만 렌더링
  currentPageData.forEach((client) => {
    const card = document.createElement("div");
    card.className = "client-card";
    let phoneDisplay = client.phone || "";
    if (client.phoneCarrier) {
      phoneDisplay = `(${client.phoneCarrier}) ` + phoneDisplay;
    }
    // 담당자 select + 배정 버튼 항상 표시
    let managerName = client.manager || '';
    let managerHtml = `<div class=\"manager-label\">담당자: 
      <select class=\"assign-manager-select\">
        <option value=\"\">선택</option>
        ${managers.map(m => `<option value=\"${m.name}\"${m.name === managerName ? ' selected' : ''}>${m.name}</option>`).join('')}
      </select>
      <button class=\"assign-manager-btn\">배정</button>
    </div>`;
    // 날짜 포맷 (년월일)
    let dateStr = '';
    if (client.created_at && client.created_at.toDate) {
      const d = client.created_at.toDate();
      dateStr = `${d.getFullYear()}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getDate().toString().padStart(2,'0')}`;
    }
    card.innerHTML = `
      <div class=\"name\" style='display:flex; justify-content:space-between; align-items:center;'>
        <span>${client.name}</span>
        <span style='font-size:13px; color:#888; margin-left:12px;'>${dateStr}</span>
      </div>
      <div class=\"phone\">${phoneDisplay}</div>
      ${managerHtml}
    `;
    card.onclick = async (e) => {
      // 배정 버튼 클릭 시에는 상세 모달 열지 않음
      if (e.target.classList.contains('assign-manager-btn')) return;
      if (e.target.classList.contains('assign-manager-select')) return;
      await showDetail(client);
    };
    // 담당자 배정 이벤트
    card.querySelector('.assign-manager-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const select = card.querySelector('.assign-manager-select');
      const selectedManager = select.value;
      if (!selectedManager) {
        showAlert('담당자를 선택해주세요.');
        return;
      }
      try {
        await updateDoc(doc(db, 'client_info', client.id), { manager: selectedManager });
        client.manager = selectedManager;
        renderCards(allClients, true); // 새로고침
        showAlert('담당자가 배정되었습니다.');
      } catch (err) {
        showAlert('담당자 배정에 실패했습니다.');
      }
    });
    cardList.appendChild(card);
  });
  
  // 더보기 버튼 상태 업데이트 (PaginationManager 사용)
  if (clientPagination) {
    const displayedItems = reset ? currentPageData.length : pagedClients.length;
    updateClientLoadMoreButton(data, displayedItems);
  }
  
  // 페이지 카운트 증가
  currentClientPage++;
}

// 고객 더보기 버튼 상태 업데이트 (PaginationManager 사용)
function updateClientLoadMoreButton(allData, displayedItems) {
  if (clientPagination) {
    const hasMore = displayedItems < allData.length;
    clientPagination.setState(displayedItems, hasMore, allData.length);
  }
}

// 담당자 카드 페이지네이션 렌더링
function renderManagerCards(data, reset = true) {
  const managerCardList = document.getElementById("managerCardList");
  if (!managerCardList) return;
  
  if (!data || data.length === 0) {
    managerCardList.innerHTML = '<div class="search-guide">등록된 담당자가 없습니다.</div>';
    updateManagerLoadMoreButton([], 0);
    return;
  }
  
  if (reset) {
    currentManagerPage = 0;
    displayedManagers = [];
    managerCardList.innerHTML = "";
  }
  
  // 현재 페이지에 표시할 데이터 계산
  const startIndex = currentManagerPage * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentPageData = data.slice(startIndex, endIndex);
  
  // 새로운 데이터를 displayedManagers에 추가
  displayedManagers = displayedManagers.concat(currentPageData);
  
  // 현재 페이지 데이터만 렌더링
  currentPageData.forEach((manager) => {
    const card = document.createElement("div");
    card.className = "manager-card";
    
    // 담당자별 고객 수 조회
    const clientCount = allClients.filter(client => client.manager === manager.name).length;
    
    // 핸드폰번호 표시 준비 (담당자 페이지에서 이미 통신사 포함해서 저장)
    let phoneDisplay = manager.phone || '';

    // 팀명과 직급을 이름 옆에 표시할 텍스트 생성
    const teamRoleText = [];
    if (manager.team) teamRoleText.push(manager.team);
    if (manager.role) teamRoleText.push(manager.role);
    const teamRoleDisplay = teamRoleText.length > 0 ? ` (${teamRoleText.join(', ')})` : '';

    card.innerHTML = `
      <div class="name" style='display:flex; justify-content:space-between; align-items:center;'>
        <span>${manager.name}<span style='font-size:14px; color:#666;'>${teamRoleDisplay}</span></span>
        <span style='font-size:13px; color:#888; margin-left:12px;'>${manager.code || ''}</span>
      </div>
      <div class="manager-details">
        ${manager.gaiaId ? `<div style="color: #6c757d; font-size: 13px; margin-bottom: 4px;">가이아: ${manager.gaiaId}</div>` : ''}
        ${phoneDisplay ? `<div style="color: #6c757d; font-size: 13px; margin-bottom: 4px;">${phoneDisplay}</div>` : ''}
        <div class="client-count" style="color: #27ae60; font-size: 14px;">
          담당 고객: ${clientCount}명
        </div>
      </div>
    `;
    
    card.onclick = () => showManagerDetail(manager);
    managerCardList.appendChild(card);
  });
  
  // 더보기 버튼 상태 업데이트 (PaginationManager 사용)
  if (managerPagination) {
    const displayedItems = reset ? currentPageData.length : displayedManagers.length;
    updateManagerLoadMoreButton(data, displayedItems);
  }
  
  // 페이지 카운트 증가
  currentManagerPage++;
}

// 담당자 더보기 버튼 상태 업데이트 (PaginationManager 사용)
function updateManagerLoadMoreButton(allData, displayedItems) {
  if (managerPagination) {
    const hasMore = displayedItems < allData.length;
    managerPagination.setState(displayedItems, hasMore, allData.length);
  }
}

// 상세 정보 표시 (수정/삭제 버튼 및 인라인 수정 폼 추가)
async function showDetail(client) {
  if (!detailContent || !detailModal) return;

  // 수정 모드 여부
  let isEditMode = false;

  async function renderDetail(editMode = false) {
    isEditMode = editMode;
    if (!editMode) {
      // 일반 상세 보기 - 헤더/바디/푸터 구조로 변경
      const modalContent = document.querySelector('.modal-content');
      if (modalContent) {
        modalContent.className = modalContent.className.replace(/\b(edit-modal|view-modal|field-modal)\b/g, '') + ' view-modal';
      }
      
      let bodyHtml = '';
      bodyHtml += `<div style='margin-bottom:10px;'><b>성함</b>: ${client.name}</div>`;
      bodyHtml += `<div style='margin-bottom:10px;'><b>주민번호</b>: ${client.ssn && client.ssn.trim() ? await decryptSSN(client.ssn) : ''}</div>`;
      bodyHtml += `<div style='margin-bottom:10px;'><b>핸드폰번호</b>: ${client.phoneCarrier ? '('+client.phoneCarrier+') ' : ''}${client.phone || ''}</div>`;
      bodyHtml += `<div style='margin-bottom:10px;'><b>회사전화번호</b>: ${client.companyPhone || ''}</div>`;
      bodyHtml += `<div style='margin-bottom:10px;'><b>주소</b>: ${(client.address || '') + (client.addressDetail ? ' ' + client.addressDetail : '')}</div>`;
      bodyHtml += `<div style='margin-bottom:10px;'><b>직장명</b>: ${client.occupation || ''}</div>`;
      bodyHtml += `<div style='margin-bottom:10px;'><b>하시는 일</b>: ${client.jobDetail || ''}</div>`;
      bodyHtml += `<div style='margin-bottom:10px;'><b>키/몸무게</b>: ${(client.height || '') + (client.height && client.weight ? ' / ' : '') + (client.weight || '')}</div>`;
      bodyHtml += `<div style='margin-bottom:10px;'><b>치료이력</b>: ${client.medicalHistory || ''}</div>`;
      bodyHtml += `<div style='margin-bottom:10px;'><b>운전여부</b>: ${client.driving === 'yes' ? '예' : client.driving === 'no' ? '아니오' : ''}</div>`;
      bodyHtml += `<div style='margin-bottom:10px;'><b>직원 수</b>: ${client.employeeCount || ''}</div>`;
      bodyHtml += `<div style='margin-bottom:10px;'><b>담당자</b>: ${client.manager || ''}</div>`;
      
      // 보험사 정보 표시
      bodyHtml += `<div style='margin-bottom:10px;'><b>보험사</b>: ${client.insuranceCompanies ? client.insuranceCompanies.join(', ') : ''}</div>`;
      
      // 비고 표시
      bodyHtml += `<div style='margin-bottom:10px;'><b>비고</b>: ${client.memo || ''}</div>`;
      // 첨부파일 표시
      bodyHtml += `<div style='margin-bottom:10px;'><b>첨부파일</b>:`;
      if (client.attachments && Object.keys(client.attachments).length > 0) {
        bodyHtml += `<button class="download-all-btn modal-btn" style="margin-left: 10px; padding: 2px 8px; font-size: 12px;">전체 다운로드</button>`;
        bodyHtml += `<ul style="list-style: none; padding-left: 0; margin-top: 5px;">`;
        Object.entries(client.attachments).forEach(([fileName, url]) => {
          bodyHtml += `<li style="display: flex; align-items: center; margin-bottom: 5px;">
            <a href="${url}" target="_blank" style="margin-right: 10px; color: #333; text-decoration: underline;">${fileName}</a>
            <button class="download-file-btn modal-btn" data-url="${url}" data-name="${fileName}" style="padding: 2px 8px; font-size: 12px; margin-right: 5px;">다운로드</button>
            <button class="delete-file-btn modal-btn red" data-client-id="${client.id}" data-file-name="${fileName}" style="padding: 2px 8px; font-size: 12px;">삭제</button>
          </li>`;
        });
        bodyHtml += `</ul>`;
      } else {
        bodyHtml += ` 없음`;
      }
      bodyHtml += `</div>`;
      
      const html = `
        <div class='modal-header'>
          <h3 style='margin:0; color:#2c3e50;'>고객 정보</h3>
        </div>
        <div class='modal-body'>
          ${bodyHtml}
        </div>
        <div class='modal-footer' style='text-align:right;'>
          <button class='edit-client-btn modal-btn blue' style='margin-right:8px;'>수정</button>
          <button class='delete-client-btn modal-btn red'>삭제</button>
        </div>
      `;
      detailContent.innerHTML = html;
    } else {
      // 편집 모드 - 헤더/바디/푸터 구조로 변경
      const modalContent = document.querySelector('.modal-content');
      if (modalContent) {
        modalContent.className = modalContent.className.replace(/\b(edit-modal|view-modal|field-modal)\b/g, '') + ' edit-modal';
      }
      
      const [phone1, phone2, phone3] = StringUtils.splitPhoneNumber(client.phone);
      const [companyPhone1, companyPhone2, companyPhone3] = StringUtils.splitPhoneNumber(client.companyPhone);
      
      const bodyHtml = `
        <div style='margin-bottom:20px;'><label for="clientInfoNm" class="editClientInfoTitle"><b>성함:</b></label> <input type='text' class="editClientInfoInput" id='edit-name' value='${client.name || ''}' /></div>
        <div style='margin-bottom:20px;'>
          <label for="clientInfoPhoneCarrier" class="editClientInfoTitle"><b>통신사:</b></label> 
          <select class="editClientInfoInput" id='edit-phone-carrier' style='margin-bottom:10px;'>
            <option value="">통신사 선택</option>
            <option value="SKT" ${client.phoneCarrier === 'SKT' ? 'selected' : ''}>SKT</option>
            <option value="KT" ${client.phoneCarrier === 'KT' ? 'selected' : ''}>KT</option>
            <option value="LGU" ${client.phoneCarrier === 'LGU' ? 'selected' : ''}>LG U+</option>
            <option value="SKT알뜰" ${client.phoneCarrier === 'SKT알뜰' ? 'selected' : ''}>SKT알뜰</option>
            <option value="KT알뜰" ${client.phoneCarrier === 'KT알뜰' ? 'selected' : ''}>KT알뜰</option>
            <option value="LGU알뜰" ${client.phoneCarrier === 'LGU알뜰' ? 'selected' : ''}>LG U+알뜰</option>
          </select>
          <div class='phone-input-container'>
            <label for="clientInfoPhone" class="editClientInfoTitle"><b>핸드폰번호:</b></label>
            <div class='phone-inputs-group'>
              <input type='text' class='editClientInfoInputPhone first' id='edit-phone1' value='${phone1}' maxlength='3' />
              <span class='phone-separator'>-</span>
              <input type='text' class='editClientInfoInputPhone middle' id='edit-phone2' value='${phone2}' maxlength='4' />
              <span class='phone-separator'>-</span>
              <input type='text' class='editClientInfoInputPhone last' id='edit-phone3' value='${phone3}' maxlength='4' />
            </div>
          </div>
        </div>
        <div class='company-phone-input-container'>
          <label for="clientInfoCompanyPhone" class="editClientInfoTitle"><b>회사전화번호:</b></label>
          <div class='phone-inputs-group'>
            <input type='text' class='editClientInfoInputPhone first' id='edit-companyPhone1' value='${companyPhone1}' maxlength='3' />
            <span class='phone-separator'>-</span>
            <input type='text' class='editClientInfoInputPhone middle' id='edit-companyPhone2' value='${companyPhone2}' maxlength='4' />
            <span class='phone-separator'>-</span>
            <input type='text' class='editClientInfoInputPhone last' id='edit-companyPhone3' value='${companyPhone3}' maxlength='4' />
          </div>
        </div>
        <div class='postcode-input-container'>
          <label for="clientInfoPostcode" class="editClientInfoTitle"><b>우편번호:</b></label> 
          <div class='postcode-inputs-group'>
            <input type='text' class="editClientInfoInput postcode-input" id='edit-postcode' value='${client.postcode || ''}' readonly />
            <button type='button' class='postcode-search-btn' onclick='openAdminPostcodeSearch()'>검색</button>
          </div>
        </div>
        <div style='margin-bottom:20px;'><label for="clientInfoAddress" class="editClientInfoTitle"><b>주소:</b></label> <input type='text' class="editClientInfoInput" id='edit-address' value='${client.address || ''}' /></div>
        <div style='margin-bottom:20px;'><label for="clientInfoAddressDetail" class="editClientInfoTitle"><b>상세주소:</b></label> <input type='text' class="editClientInfoInput" id='edit-addressDetail' value='${client.addressDetail || ''}' /></div>
        <div style='margin-bottom:20px;'><label for="clientInfoOccupation" class="editClientInfoTitle"><b>직장명:</b></label> <input type='text' class="editClientInfoInput" id='edit-occupation' value='${client.occupation || ''}' /></div>
        <div style='margin-bottom:20px;'><label for="clientInfoJobDetail" class="editClientInfoTitle"><b>하시는 일:</b></label> <input type='text' class="editClientInfoInput" id='edit-jobDetail' value='${client.jobDetail || ''}' /></div>
        <div style='margin-bottom:20px;'><label for="clientInfoHeight" class="editClientInfoTitleSec"><b>키:</b></label> <input type='text' class='editClientInfoInputSec' id='edit-height' value='${client.height || ''}' /> / <label for="clientInfoWeight" class="editClientInfoTitleSec"><b>몸무게:</b></label> <input type='text' class='editClientInfoInputSec' id='edit-weight' value='${client.weight || ''}' /></div>
        <div style='margin-bottom:20px;'><label for="clientInfoMedicalHistory" class="editClientInfoTitle"><b>치료이력:</b></label> <input type='text' class="editClientInfoInput" id='edit-medicalHistory' value='${client.medicalHistory || ''}' /></div>
        <div style='margin-bottom:20px;'><label for="clientInfoDriving" class="editClientInfoTitle"><b>운전여부:</b></label> <select class="editClientInfoInput" id='edit-driving'><option value=''>선택</option><option value='yes' ${client.driving==='yes'?'selected':''}>예</option><option value='no' ${client.driving==='no'?'selected':''}>아니오</option></select></div>
        <div style='margin-bottom:20px;'><label for="clientInfoEmployeeCount" class="editClientInfoTitle"><b>직원 수:</b></label> <input type='text' class="editClientInfoInput" id='edit-employeeCount' value='${client.employeeCount || ''}' /></div>
        <div style='margin-bottom:20px;'><label for="clientInfoManager" class="editClientInfoTitle"><b>담당자:</b></label> <select class="editClientInfoInput" id='edit-manager'><option value=''>선택</option>${managers.map(m => `<option value='${m.name}'${m.name===client.manager?' selected':''}>${m.name}</option>`).join('')}</select></div>
        <div style='margin-bottom:20px;'><b>등록완료 보험사:</b>
          <div style='margin-top:4px; margin-bottom:4px;'><b style='color:#27ae60;'>생명보험사</b></div>
          <div style='display:grid; grid-template-columns:repeat(2,1fr); gap:8px; margin-bottom:8px;'>
            ${lifeCompanies.map(company => `
              <label style='display:flex; align-items:center; gap:4px;'>
                <input type='checkbox' name='insurance' value='${company}' 
                  ${client.insuranceCompanies && client.insuranceCompanies.includes(company) ? 'checked' : ''}>
                ${company}
              </label>
            `).join('')}
          </div>
          <div style='margin-top:4px; margin-bottom:4px;'><b style='color:#3498db;'>손해보험사</b></div>
          <div style='display:grid; grid-template-columns:repeat(2,1fr); gap:8px;'>
            ${nonLifeCompanies.map(company => `
              <label style='display:flex; align-items:center; gap:4px;'>
                <input type='checkbox' name='insurance' value='${company}' 
                  ${client.insuranceCompanies && client.insuranceCompanies.includes(company) ? 'checked' : ''}>
                ${company}
              </label>
            `).join('')}
          </div>
        </div>
        <div style='margin-bottom:10px;'><b>비고:</b><br/>
          <textarea id='edit-note' style='width:100%; height:80px; margin-top:4px; padding:8px; border:1px solid #ccc; border-radius:4px;'>${client.memo || ''}</textarea>
        </div>
      `;
      
      const html = `
        <div class='modal-header'>
          <h3 style='margin:0; color:#2c3e50;'>고객 정보 수정</h3>
        </div>
        <div class='modal-body'>
          ${bodyHtml}
        </div>
        <div class='modal-footer' style='text-align:right;'>
          <button class='save-client-btn modal-btn blue' style='margin-right:8px;'>저장</button>
          <button class='cancel-client-btn modal-btn'>취소</button>
        </div>
      `;
      detailContent.innerHTML = html;
    }
  }

  await renderDetail(false);
  detailModal.style.display = "flex";
  document.body.classList.add('modal-open');
  
  // ESC 키로 단계별 뒤로가기 - 기존 리스너 정리
  document.removeEventListener('keydown', window.currentClientEscHandler);
  
  const handleClientEscKey = (e) => {
    if (e.key === 'Escape') {
      const modalContent = document.querySelector('.modal-content');
      if (modalContent && modalContent.classList.contains('edit-modal')) {
        // 편집 모드에서 ESC: 보기 모드로 돌아가기
        renderDetail(false);
      } else {
        // 보기 모드에서 ESC: 모달 완전히 닫기
        detailModal.style.display = "none";
        document.body.classList.remove('modal-open');
        document.removeEventListener('keydown', handleClientEscKey);
        window.currentClientEscHandler = null;
      }
    }
  };
  
  window.currentClientEscHandler = handleClientEscKey;
  document.addEventListener('keydown', handleClientEscKey);

  // 모달 내 버튼 이벤트 위임
  detailContent.onclick = async (e) => {
    if (e.target.classList.contains('edit-client-btn')) {
      renderDetail(true);
    } else if (e.target.classList.contains('cancel-client-btn')) {
      renderDetail(false);
    } else if (e.target.classList.contains('save-client-btn')) {
      // 수정 저장
      const selectedInsuranceCompanies = Array.from(document.querySelectorAll('input[name="insurance"]:checked'))
        .map(checkbox => checkbox.value);
      // 전화번호 합치기
      const phone = [
        document.getElementById('edit-phone1').value,
        document.getElementById('edit-phone2').value,
        document.getElementById('edit-phone3').value
      ].join('-');
      const companyPhone = [
        document.getElementById('edit-companyPhone1').value,
        document.getElementById('edit-companyPhone2').value,
        document.getElementById('edit-companyPhone3').value
      ].join('-');
      const updateData = {
        name: document.getElementById('edit-name').value,
        phoneCarrier: document.getElementById('edit-phone-carrier').value,
        phone,
        companyPhone,
        postcode: document.getElementById('edit-postcode').value,
        address: document.getElementById('edit-address').value,
        addressDetail: document.getElementById('edit-addressDetail').value,
        occupation: document.getElementById('edit-occupation').value,
        jobDetail: document.getElementById('edit-jobDetail').value,
        height: document.getElementById('edit-height').value,
        weight: document.getElementById('edit-weight').value,
        medicalHistory: document.getElementById('edit-medicalHistory').value,
        driving: document.getElementById('edit-driving').value,
        employeeCount: document.getElementById('edit-employeeCount').value,
        manager: document.getElementById('edit-manager').value,
        insuranceCompanies: selectedInsuranceCompanies,
        memo: document.getElementById('edit-note').value
      };
      try {
        await updateDoc(doc(db, 'client_info', client.id), updateData);
        Object.assign(client, updateData);
        showAlert('수정되었습니다.');
        renderDetail(false);
      } catch (err) {
        showAlert('수정에 실패했습니다.');
      }
    } else if (e.target.classList.contains('download-file-btn')) {
      e.preventDefault();
      const button = e.target;
      const url = button.dataset.url;
      const name = button.dataset.name;
      
      // 로딩 상태 표시
      const originalText = button.textContent;
      button.textContent = '다운중...';
      button.disabled = true;
      
      // fetch를 사용해서 파일 다운로드
      fetch(url)
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response.blob();
        })
        .then(blob => {
          // blob URL 생성 및 다운로드
          const blobUrl = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = name;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(blobUrl);
          
          // 버튼 상태 복원
          button.textContent = originalText;
          button.disabled = false;
        })
        .catch(error => {
          console.error('다운로드 실패:', error);
          showAlert('파일 다운로드에 실패했습니다.');
          
          // 버튼 상태 복원
          button.textContent = originalText;
          button.disabled = false;
        });
    } else if (e.target.classList.contains('download-all-btn')) {
      e.preventDefault();
      const button = e.target;
      
      // 로딩 상태 표시
      const originalText = button.textContent;
      button.textContent = '압축중...';
      button.disabled = true;
      
      // JSZip을 사용해서 모든 파일 압축
      const zip = new JSZip();
      const attachments = client.attachments;
      const filePromises = [];
      
      // 모든 파일을 병렬로 다운로드
      Object.entries(attachments).forEach(([fileName, url]) => {
        const filePromise = fetch(url)
          .then(response => {
            if (!response.ok) {
              throw new Error(`파일 다운로드 실패: ${fileName}`);
            }
            return response.blob();
          })
          .then(blob => {
            zip.file(fileName, blob);
          })
          .catch(error => {
            console.error(`파일 다운로드 실패 (${fileName}):`, error);
            throw error;
          });
        filePromises.push(filePromise);
      });
      
      // 모든 파일 다운로드 완료 후 압축 파일 생성
      Promise.all(filePromises)
        .then(() => {
          return zip.generateAsync({ type: 'blob' });
        })
        .then(blob => {
          // 압축 파일 다운로드
          const blobUrl = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = `${client.name}_첨부파일.zip`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(blobUrl);
          
          // 버튼 상태 복원
          button.textContent = originalText;
          button.disabled = false;
        })
        .catch(error => {
          console.error('전체 다운로드 실패:', error);
          showAlert('전체 파일 다운로드에 실패했습니다.');
          
          // 버튼 상태 복원
          button.textContent = originalText;
          button.disabled = false;
        });
    } else if (e.target.classList.contains('delete-file-btn')) {
      const button = e.target;
      const clientId = button.dataset.clientId;
      const fileName = button.dataset.fileName;

      if (confirm(`'${fileName}' 파일을 정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
        try {
          // 1. Firebase Storage에서 파일 삭제
          const fileRef = ref(storage, `attachments/${client.attachments[fileName].split('_').pop().split('?')[0]}`);
          const fileFullPath = ref(storage, client.attachments[fileName]);
          await deleteObject(fileFullPath);
          
          // 2. Firestore에서 파일 정보 업데이트
          const updatedAttachments = { ...client.attachments };
          delete updatedAttachments[fileName];
          
          const clientDocRef = doc(db, 'client_info', clientId);
          await updateDoc(clientDocRef, { attachments: updatedAttachments });
          
          // 3. UI 업데이트
          client.attachments = updatedAttachments;
          renderDetail(false);
          alert('파일이 성공적으로 삭제되었습니다.');

        } catch (error) {
          console.error("파일 삭제 실패:", error);
          alert("파일 삭제 중 오류가 발생했습니다. 자세한 내용은 콘솔을 확인해주세요.");
        }
      }
    } else if (e.target.classList.contains('delete-client-btn')) {
      if (confirm('정말 삭제하시겠습니까?\n고객 정보와 함께 업로드된 모든 첨부파일이 영구적으로 삭제됩니다.')) {
        try {
          // 1. 첨부파일이 있으면 Storage에서 모두 삭제
          if (client.attachments && Object.keys(client.attachments).length > 0) {
            const deletePromises = Object.values(client.attachments).map(url => {
              const fileRef = ref(storage, url);
              return deleteObject(fileRef).catch(err => {
                // 개별 파일 삭제 실패 시 콘솔에 로그만 남기고 계속 진행
                console.error(`파일 삭제 실패: ${url}`, err);
              });
            });
            await Promise.all(deletePromises);
          }

          // 2. Firestore에서 고객 정보 삭제
          await deleteDoc(doc(db, 'client_info', client.id));
          
          // 3. UI 업데이트
          detailModal.style.display = 'none';
          document.body.classList.remove('modal-open');
          
          // 즉각적인 UI 반응을 위해 로컬 데이터에서도 삭제 후 리렌더링.
          // onSnapshot이 결국 덮어쓰겠지만, 사용자 경험을 향상시킴.
          allClients = allClients.filter(c => c.id !== client.id);
          if (searchInput && searchInput.value.trim()) {
              handleSearch.call(searchInput);
          } else {
              renderCards(allClients, true);
          }

          alert('고객 정보가 성공적으로 삭제되었습니다.');

        } catch (err) {
          console.error('고객 정보 삭제 실패:', err);
          alert('고객 정보 삭제에 실패했습니다.');
        }
      }
    }
  };

  // 모달창 스타일 넓히기 및 모바일 대응
  if (detailModal) {
    const modalContent = detailModal.querySelector('.modal-content');
    modalContent.style.maxWidth = '600px';
    modalContent.style.width = '95vw';
    modalContent.style.maxHeight = '90vh';
    modalContent.style.overflowY = 'auto';
  }
}



// 보험사 아코디언 렌더링 함수
function renderInsuranceAccordion(manager) {
  const registeredLife = lifeInsuranceCompanies.filter(comp => {
    const account = manager.insuranceAccounts?.[comp.key];
    return account && account.employeeId && account.password;
  });
  const registeredNonLife = nonLifeInsuranceCompanies.filter(comp => {
    const account = manager.insuranceAccounts?.[comp.key];
    return account && account.employeeId && account.password;
  });
  const totalRegistered = registeredLife.length + registeredNonLife.length;
  
  let html = `
    <div style='margin-bottom:15px;'>
      <div style='display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;'>
        <b>보험사 계정 정보</b>
        <span style='font-size:12px; color:#666;'>(등록: ${totalRegistered}개 / 전체: ${lifeInsuranceCompanies.length + nonLifeInsuranceCompanies.length}개)</span>
      </div>
      
      <!-- 검색창 -->
      <div style='margin-bottom:15px;'>
        <input type='text' id='insurance-search' placeholder='보험사명으로 검색...' 
               style='width:100%; padding:8px; border:1px solid #ddd; border-radius:4px; font-size:14px;' />
      </div>
      
      <!-- 생명보험사 아코디언 -->
      <div style='border:1px solid #ddd; border-radius:6px; margin-bottom:10px;'>
        <div class='accordion-header' data-target='life-insurance' 
             style='background:#f8f9fa; padding:12px; cursor:pointer; display:flex; align-items:center; justify-content:space-between; border-radius:6px;'>
          <span style='font-weight:bold; color:#27ae60;'>
            <span class='accordion-icon'><i class='fas fa-chevron-right'></i></span> 생명보험사 (등록: ${registeredLife.length}개 / 전체: ${lifeInsuranceCompanies.length}개)
          </span>
        </div>
        <div id='life-insurance-content' class='accordion-content' style='padding:0; display:none;'>
  `;
  
  // 생명보험사 목록
  for (const comp of lifeInsuranceCompanies) {
    const account = manager.insuranceAccounts?.[comp.key];
    const isRegistered = !!(account && account.employeeId && account.password);
    
    let passwordDisplay = '';
    if (account?.password) {
      passwordDisplay = '로딩 중...';
    }
    
    html += `
      <div class='insurance-item' data-company-name='${comp.name}' data-company-key='${comp.key}'
           style='padding:10px 15px; border-bottom:1px solid #f0f0f0; display:flex; align-items:center; justify-content:space-between;'>
        <div style='flex:1;'>
          <span style='font-weight:${isRegistered ? 'bold' : 'normal'}; color:${isRegistered ? '#2c3e50' : '#999'};'>
            ${isRegistered ? '<i class="fas fa-check-circle" style="color: #28a745;"></i>' : '<i class="fas fa-times-circle" style="color: #dc3545;"></i>'} ${comp.name}
          </span>
          ${account ? `
            <div style='font-size:12px; color:#666; margin-top:2px;'>
              사원번호: ${account.employeeId || '미등록'} / 비밀번호: <span class='password-display'>${passwordDisplay || '미등록'}</span>
            </div>
          ` : ''}
        </div>
        <div>
          ${account ? `
            <button class='insurance-edit-btn' data-company='${comp.key}' data-company-name='${comp.name}'
                    style='padding:4px 8px; font-size:12px; background:#17a2b8; color:white; border:none; border-radius:3px; cursor:pointer; margin-right:4px;'>수정</button>
          ` : `
            <button class='insurance-add-btn' data-company='${comp.key}' data-company-name='${comp.name}'
                    style='padding:4px 8px; font-size:12px; background:#28a745; color:white; border:none; border-radius:3px; cursor:pointer;'>등록</button>
          `}
        </div>
      </div>
    `;
  }
  
  html += `
        </div>
      </div>
      
      <!-- 손해보험사 아코디언 -->
      <div style='border:1px solid #ddd; border-radius:6px;'>
        <div class='accordion-header' data-target='nonlife-insurance'
             style='background:#f8f9fa; padding:12px; cursor:pointer; display:flex; align-items:center; justify-content:space-between; border-radius:6px;'>
          <span style='font-weight:bold; color:#3498db;'>
            <span class='accordion-icon'><i class='fas fa-chevron-right'></i></span> 손해보험사 (등록: ${registeredNonLife.length}개 / 전체: ${nonLifeInsuranceCompanies.length}개)
          </span>
        </div>
        <div id='nonlife-insurance-content' class='accordion-content' style='padding:0; display:none;'>
  `;
  
  // 손해보험사 목록
  for (const comp of nonLifeInsuranceCompanies) {
    const account = manager.insuranceAccounts?.[comp.key];
    const isRegistered = !!(account && account.employeeId && account.password);
    
    let passwordDisplay = '';
    if (account?.password) {
      passwordDisplay = '로딩 중...';
    }
    
    html += `
      <div class='insurance-item' data-company-name='${comp.name}' data-company-key='${comp.key}'
           style='padding:10px 15px; border-bottom:1px solid #f0f0f0; display:flex; align-items:center; justify-content:space-between;'>
        <div style='flex:1;'>
          <span style='font-weight:${isRegistered ? 'bold' : 'normal'}; color:${isRegistered ? '#2c3e50' : '#999'};'>
            ${isRegistered ? '<i class="fas fa-check-circle" style="color: #28a745;"></i>' : '<i class="fas fa-times-circle" style="color: #dc3545;"></i>'} ${comp.name}
          </span>
          ${account ? `
            <div style='font-size:12px; color:#666; margin-top:2px;'>
              사원번호: ${account.employeeId || '미등록'} / 비밀번호: <span class='password-display'>${passwordDisplay || '미등록'}</span>
            </div>
          ` : ''}
        </div>
        <div>
          ${account ? `
            <button class='insurance-edit-btn' data-company='${comp.key}' data-company-name='${comp.name}'
                    style='padding:4px 8px; font-size:12px; background:#17a2b8; color:white; border:none; border-radius:3px; cursor:pointer; margin-right:4px;'>수정</button>
          ` : `
            <button class='insurance-add-btn' data-company='${comp.key}' data-company-name='${comp.name}'
                    style='padding:4px 8px; font-size:12px; background:#28a745; color:white; border:none; border-radius:3px; cursor:pointer;'>등록</button>
          `}
        </div>
      </div>
    `;
  }
  
  html += `
        </div>
      </div>
    </div>
  `;
  
  return html;
}

// 캐시된 데이터를 사용하는 보험사 아코디언 렌더링 함수
function renderInsuranceAccordionWithCache(manager, decryptedCache) {
  const registeredLife = lifeInsuranceCompanies.filter(comp => {
    const account = manager.insuranceAccounts?.[comp.key];
    return account && account.employeeId && account.password;
  });
  const registeredNonLife = nonLifeInsuranceCompanies.filter(comp => {
    const account = manager.insuranceAccounts?.[comp.key];
    return account && account.employeeId && account.password;
  });
  const totalRegistered = registeredLife.length + registeredNonLife.length;
  
  let html = `
    <div style='margin-bottom:15px;'>
      <div style='display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;'>
        <b>보험사 계정 정보</b>
        <span style='font-size:12px; color:#666;'>(등록: ${totalRegistered}개 / 전체: ${lifeInsuranceCompanies.length + nonLifeInsuranceCompanies.length}개)</span>
      </div>
      
      <!-- 검색창 -->
      <div style='margin-bottom:15px;'>
        <input type='text' id='insurance-search' placeholder='보험사명으로 검색...' 
               style='width:100%; padding:8px; border:1px solid #ddd; border-radius:4px; font-size:14px;' />
      </div>
      
      <!-- 생명보험사 아코디언 -->
      <div style='border:1px solid #ddd; border-radius:6px; margin-bottom:10px;'>
        <div class='accordion-header' data-target='life-insurance' 
             style='background:#f8f9fa; padding:12px; cursor:pointer; display:flex; align-items:center; justify-content:space-between; border-radius:6px;'>
          <span style='font-weight:bold; color:#27ae60;'>
            <span class='accordion-icon'><i class='fas fa-chevron-right'></i></span> 생명보험사 (등록: ${registeredLife.length}개 / 전체: ${lifeInsuranceCompanies.length}개)
          </span>
        </div>
        <div id='life-insurance-content' class='accordion-content' style='padding:0; display:none;'>
  `;
  
  // 생명보험사 목록
  for (const comp of lifeInsuranceCompanies) {
    const account = manager.insuranceAccounts?.[comp.key];
    const isRegistered = !!(account && account.employeeId && account.password);
    
    let passwordDisplay = '';
    if (account?.password) {
      passwordDisplay = decryptedCache.loaded.insurancePasswords.has(comp.key) ? (decryptedCache.insurancePasswords[comp.key] || '복호화 실패') : '로딩 중...';
    }
    
    html += `
      <div class='insurance-item' data-company-name='${comp.name}' data-company-key='${comp.key}'
           style='padding:10px 15px; border-bottom:1px solid #f0f0f0; display:flex; align-items:center; justify-content:space-between;'>
        <div style='flex:1;'>
          <span style='font-weight:${isRegistered ? 'bold' : 'normal'}; color:${isRegistered ? '#2c3e50' : '#999'};'>
            ${isRegistered ? '<i class="fas fa-check-circle" style="color: #28a745;"></i>' : '<i class="fas fa-times-circle" style="color: #dc3545;"></i>'} ${comp.name}
          </span>
          ${account ? `
            <div style='font-size:12px; color:#666; margin-top:2px;'>
              사원번호: ${account.employeeId || '미등록'} / 비밀번호: <span class='password-display'>${passwordDisplay || '미등록'}</span>
            </div>
          ` : ''}
        </div>
        <div>
          ${account ? `
            <button class='insurance-edit-btn' data-company='${comp.key}' data-company-name='${comp.name}'
                    style='padding:4px 8px; font-size:12px; background:#17a2b8; color:white; border:none; border-radius:3px; cursor:pointer; margin-right:4px;'>수정</button>
          ` : `
            <button class='insurance-add-btn' data-company='${comp.key}' data-company-name='${comp.name}'
                    style='padding:4px 8px; font-size:12px; background:#28a745; color:white; border:none; border-radius:3px; cursor:pointer;'>등록</button>
          `}
        </div>
      </div>
    `;
  }
  
  html += `
        </div>
      </div>
      
      <!-- 손해보험사 아코디언 -->
      <div style='border:1px solid #ddd; border-radius:6px;'>
        <div class='accordion-header' data-target='nonlife-insurance'
             style='background:#f8f9fa; padding:12px; cursor:pointer; display:flex; align-items:center; justify-content:space-between; border-radius:6px;'>
          <span style='font-weight:bold; color:#3498db;'>
            <span class='accordion-icon'><i class='fas fa-chevron-right'></i></span> 손해보험사 (등록: ${registeredNonLife.length}개 / 전체: ${nonLifeInsuranceCompanies.length}개)
          </span>
        </div>
        <div id='nonlife-insurance-content' class='accordion-content' style='padding:0; display:none;'>
  `;
  
  // 손해보험사 목록
  for (const comp of nonLifeInsuranceCompanies) {
    const account = manager.insuranceAccounts?.[comp.key];
    const isRegistered = !!(account && account.employeeId && account.password);
    
    let passwordDisplay = '';
    if (account?.password) {
      passwordDisplay = decryptedCache.loaded.insurancePasswords.has(comp.key) ? (decryptedCache.insurancePasswords[comp.key] || '복호화 실패') : '로딩 중...';
    }
    
    html += `
      <div class='insurance-item' data-company-name='${comp.name}' data-company-key='${comp.key}'
           style='padding:10px 15px; border-bottom:1px solid #f0f0f0; display:flex; align-items:center; justify-content:space-between;'>
        <div style='flex:1;'>
          <span style='font-weight:${isRegistered ? 'bold' : 'normal'}; color:${isRegistered ? '#2c3e50' : '#999'};'>
            ${isRegistered ? '<i class="fas fa-check-circle" style="color: #28a745;"></i>' : '<i class="fas fa-times-circle" style="color: #dc3545;"></i>'} ${comp.name}
          </span>
          ${account ? `
            <div style='font-size:12px; color:#666; margin-top:2px;'>
              사원번호: ${account.employeeId || '미등록'} / 비밀번호: <span class='password-display'>${passwordDisplay || '미등록'}</span>
            </div>
          ` : ''}
        </div>
        <div>
          ${account ? `
            <button class='insurance-edit-btn' data-company='${comp.key}' data-company-name='${comp.name}'
                    style='padding:4px 8px; font-size:12px; background:#17a2b8; color:white; border:none; border-radius:3px; cursor:pointer; margin-right:4px;'>수정</button>
          ` : `
            <button class='insurance-add-btn' data-company='${comp.key}' data-company-name='${comp.name}'
                    style='padding:4px 8px; font-size:12px; background:#28a745; color:white; border:none; border-radius:3px; cursor:pointer;'>등록</button>
          `}
        </div>
      </div>
    `;
  }
  
  html += `
        </div>
      </div>
    </div>
  `;
  
  return html;
}

// 담당자 상세 정보 모달
function showManagerDetail(manager) {
  if (!detailContent || !detailModal) return;

  // 담당자별 복호화 캐시 가져오기 또는 초기화
  const managerId = manager.id || manager.name;
  if (!managerDecryptionCache[managerId]) {
    managerDecryptionCache[managerId] = {
      ssn: null,
      gaiaPassword: null,
      insurancePasswords: {},
      isLoading: true,
      loaded: {
        ssn: false,
        gaiaPassword: false,
        insurancePasswords: new Set()
      }
    };
  }
  
  const decryptedCache = managerDecryptionCache[managerId];

  // 가이아 비밀번호 복호화 헬퍼 함수
  async function getDecryptedGaiaPassword(manager) {
    if (!manager.gaiaPassword) return '';
    try {
      const decrypted = await decryptSSN(manager.gaiaPassword);
      return decrypted || '';
    } catch (e) {
      console.error('가이아 비밀번호 복호화 실패:', e);
      return '';
    }
  }

  function renderManagerDetail(editMode = false) {
    
    // 담당자 고객 목록 조회
    const managerClients = allClients.filter(client => client.manager === manager.name);
    
    if (!editMode) {
      // 일반 상세 보기 - 모든 모달 클래스를 한 번에 변경
      const modalContent = document.querySelector('.modal-content');
      if (modalContent) {
        modalContent.className = modalContent.className.replace(/\b(edit-modal|view-modal|field-modal)\b/g, '') + ' view-modal';
      }
      
      let html = `
        <div class='modal-header'>
          <h3 style='margin:0; color:#2c3e50;'>담당자 정보 조회</h3>
        </div>
        <div class='modal-body'>
      `;
      html += `<div style='margin-bottom:15px;'><b>담당자명</b>: ${manager.name}</div>`;
      html += `<div style='margin-bottom:15px;'><b>담당자 코드</b>: ${manager.code || ''}</div>`;
      html += `<div style='margin-bottom:15px; display:flex; align-items:center; justify-content:space-between;'>
        <span><b>로그인 비밀번호</b>: ${manager.password ? '설정됨' : '미설정'}</span>
        <button class='password-reset-btn' data-manager-id='${manager.id}' style='padding:6px 12px; font-size:12px; background:#dc3545; color:white; border:none; border-radius:4px; cursor:pointer;'>비밀번호 초기화</button>
      </div>`;
      html += `<div style='margin-bottom:15px; display:flex; align-items:center; justify-content:space-between;'>
        <span><b>팀</b>: ${manager.team ? (manager.team.endsWith('팀') ? manager.team : manager.team + '팀') : ''}</span>
        <button class='field-edit-btn' data-field='team' style='padding:4px 8px; font-size:12px; background:#28a745; color:white; border:none; border-radius:3px; cursor:pointer;'>수정</button>
      </div>`;
      html += `<div style='margin-bottom:15px; display:flex; align-items:center; justify-content:space-between;'>
        <span><b>직급</b>: ${manager.role || ''}</span>
        <button class='field-edit-btn' data-field='role' style='padding:4px 8px; font-size:12px; background:#28a745; color:white; border:none; border-radius:3px; cursor:pointer;'>수정</button>
      </div>`;
      
      // 주민등록번호 표시 (캐시 우선 사용)
      if (manager.ssn) {
        const displayValue = decryptedCache.loaded.ssn ? (decryptedCache.ssn || '복호화 실패') : '로딩 중...';
        html += `<div style='margin-bottom:15px;'><b>주민등록번호</b>: <span id='ssn-display'>${displayValue}</span></div>`;
      }
      
      // 핸드폰번호 표시 (담당자 페이지에서 이미 통신사 포함해서 저장하므로 그대로 표시)
      let phoneDisplay = manager.phone || '';
      html += `<div style='margin-bottom:15px; display:flex; align-items:center; justify-content:space-between;'>
        <span><b>핸드폰번호</b>: ${phoneDisplay}</span>
        <button class='field-edit-btn' data-field='phone' style='padding:4px 8px; font-size:12px; background:#28a745; color:white; border:none; border-radius:3px; cursor:pointer;'>수정</button>
      </div>`;
      
      // 가이아 정보 표시 (핸드폰번호 바로 아래)
      html += `<div style='margin-bottom:15px;'><b>가이아</b>: ${manager.gaiaId || ''}</div>`;
      
      // 가이아 비밀번호 표시 (캐시 우선 사용)
      if (manager.gaiaPassword) {
        const displayValue = decryptedCache.loaded.gaiaPassword ? (decryptedCache.gaiaPassword || '복호화 실패') : (decryptedCache.isLoading ? '로딩 중...' : '복호화 실패');
        html += `<div style='margin-bottom:15px; display:flex; align-items:center; justify-content:space-between;' id='gaia-password-container'>
          <span><b>가이아 비밀번호</b>: <span id='gaia-password-display'>${displayValue}</span></span>
          <button class='field-edit-btn' data-field='gaiaPassword' style='padding:4px 8px; font-size:12px; background:#28a745; color:white; border:none; border-radius:3px; cursor:pointer;'>수정</button>
        </div>`;
      } else {
        html += `<div style='margin-bottom:15px; display:flex; align-items:center; justify-content:space-between;'>
          <span><b>가이아 비밀번호</b>: 미등록</span>
          <button class='field-edit-btn' data-field='gaiaPassword' style='padding:4px 8px; font-size:12px; background:#28a745; color:white; border:none; border-radius:3px; cursor:pointer;'>수정</button>
        </div>`;
      }
      
      // 비고 표시
      if (manager.notes) {
        html += `<div style='margin-bottom:15px;'><b>비고</b>: ${manager.notes}</div>`;
      }
      
      // 보험사 정보 표시 (아코디언 + 검색) - 캐시 우선 사용
      if (decryptedCache.isLoading) {
        html += `<div id="insurance-accordion-container">보험사 정보 로딩 중...</div>`;
      } else {
        html += `<div id="insurance-accordion-container">${renderInsuranceAccordionWithCache(manager, decryptedCache)}</div>`;
      }
      
      html += `<div style='margin-bottom:15px;'><b>담당 고객 수</b>: ${managerClients.length}명</div>`;
      
      // 담당자 링크
      const managerUrl = `https://owners-client.info/index.html?manager=${manager.code || ''}`;
      html += `<div style='margin-bottom:15px;'><b>담당자 링크</b>: 
        <span style='color:#3498db; cursor:pointer; text-decoration:underline;' onclick='copyToClipboard("${managerUrl}")'>
          링크 복사
        </span>
      </div>`;
      
      // 담당 고객 목록
      html += `<div style='margin-bottom:10px;'><b>담당 고객 목록</b>:</div>`;
      if (managerClients.length > 0) {
        html += `<div style='max-height:250px; overflow-y:auto; border:1px solid #eee; border-radius:5px;'>`;
        managerClients.forEach((client) => {
          const dateStr = client.created_at && client.created_at.toDate ? 
            client.created_at.toDate().toLocaleDateString('ko-KR') : '';
          
          // 회사명 정보 (occupation 또는 jobDetail에서 추출)
          let companyInfo = '';
          if (client.occupation && client.occupation !== '기타') {
            companyInfo = client.occupation;
          } else if (client.jobDetail) {
            companyInfo = client.jobDetail;
          }
          
          html += `
            <div style='padding:12px; border-bottom:1px solid #f0f0f0; transition: background-color 0.2s;' 
                 onmouseover='this.style.backgroundColor="#f8f9fa"' 
                 onmouseout='this.style.backgroundColor=""'>
              <div style='display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;'>
                <span style='font-weight:bold; color:#2c3e50;'>${client.name}</span>
                <span style='font-size:11px; color:#999;'>${dateStr}</span>
              </div>
              ${client.phone ? `<div style='font-size:13px; color:#666; margin-bottom:2px;'><i class='fas fa-mobile-alt' style='width:14px; margin-right:6px;'></i>${client.phone}</div>` : ''}
              ${companyInfo ? `<div style='font-size:13px; color:#666;'><i class='fas fa-building' style='width:14px; margin-right:6px;'></i>${companyInfo}</div>` : ''}
              ${!client.phone && !companyInfo ? `<div style='font-size:12px; color:#999; font-style:italic;'>연락처 정보 없음</div>` : ''}
            </div>
          `;
        });
        html += `</div>`;
      } else {
        html += `<div style='color:#888; font-style:italic;'>담당 고객이 없습니다.</div>`;
      }

      // modal-body 닫기와 modal-footer 추가
      html += `
        </div>
        <div class='modal-footer' style='text-align:right;'>
          <button class='edit-manager-btn modal-btn blue'>수정</button>
        </div>
      `;
      
      detailContent.innerHTML = html;
      
      // x 버튼 다시 보이기 (담당자 상세 모드)
      const closeBtn = document.getElementById('closeModal');
      if (closeBtn) closeBtn.style.display = 'block';
    } else {
      // 편집 모드
      // 핸드폰번호에서 통신사와 전화번호 분리
      let phoneCarrier = '';
      let phoneNumber = manager.phone || '';
      
      // "SKT 010-5540-5543" 형태에서 통신사와 전화번호 분리
      if (phoneNumber.includes(' ') && phoneNumber.match(/^[A-Z가-힣]+\s/)) {
        const parts = phoneNumber.split(' ');
        phoneCarrier = parts[0];
        phoneNumber = parts.slice(1).join(' ');
      }
      
      const [phone1, phone2, phone3] = StringUtils.splitPhoneNumber(phoneNumber);
      
      // 주민등록번호는 캐시 우선 사용
      let ssnFront = '';
      let ssnBack = '';
      if (manager.ssn) {
        if (decryptedCache.ssn && decryptedCache.ssn.includes('-')) {
          [ssnFront, ssnBack] = decryptedCache.ssn.split('-');
        } else if (decryptedCache.isLoading) {
          ssnFront = '로딩';
          ssnBack = '중';
        }
      }
      
      // 팀명에서 '팀' 제거 (입력 시에는 숫자만)
      const teamDisplay = manager.team ? manager.team.replace('팀', '') : '';
      
      // 전체 수정 모달용 클래스 추가
      const modalContent = document.querySelector('.modal-content');
      if (modalContent) {
        modalContent.className = modalContent.className.replace(/\b(edit-modal|view-modal|field-modal)\b/g, '') + ' edit-modal';
      }
      
      detailContent.innerHTML = `
        <div class='modal-header'>
          <h3 style='margin:0; color:#2c3e50;'>담당자 정보 수정</h3>
        </div>
        <div class='modal-body'>
          <div style='margin-bottom:20px;'><label class="editClientInfoTitle"><b>담당자명:</b></label> <input type='text' class="editClientInfoInput" id='edit-manager-name' value='${manager.name || ''}' /></div>
          <div style='margin-bottom:20px; display: flex; align-items: center; gap: 8px;'>
            <label class="editClientInfoTitle" style='margin-bottom: 0;'><b>팀:</b></label> 
            <input type='text' class="editClientInfoInput" id='edit-manager-team' value='${teamDisplay}' placeholder='숫자만 입력 (예: 3)' style='flex: 1;' />
            <span style='font-weight: bold; color: #2c3e50;'>팀</span>
          </div>
          <div style='margin-bottom:20px;'><label class="editClientInfoTitle"><b>직급:</b></label> 
            <select class="editClientInfoInput" id='edit-manager-role'>
              <option value="">직급 선택</option>
              <option value="BM" ${manager.role === 'BM' ? 'selected' : ''}>BM</option>
              <option value="ABM" ${manager.role === 'ABM' ? 'selected' : ''}>ABM</option>
              <option value="SM" ${manager.role === 'SM' ? 'selected' : ''}>SM</option>
              <option value="ASM" ${manager.role === 'ASM' ? 'selected' : ''}>ASM</option>
              <option value="팀장" ${manager.role === '팀장' ? 'selected' : ''}>팀장</option>
            </select>
          </div>
          <div style='margin-bottom:20px;'><label class="editClientInfoTitle"><b>주민번호:</b></label> 
            <input type='tel' class='editClientInfoInputSSN front' id='edit-manager-ssn-front' value='${ssnFront}' maxlength='6' placeholder='앞 6자리' /> -
            <input type='tel' class='editClientInfoInputSSN back' id='edit-manager-ssn-back' value='${ssnBack}' maxlength='7' placeholder='뒤 7자리' />
          </div>
          <div style='margin-bottom:20px;'><label class="editClientInfoTitle"><b>통신사:</b></label> 
            <select class="editClientInfoInput" id='edit-manager-phone-carrier'>
              <option value="">통신사</option>
              <option value="SKT" ${phoneCarrier === 'SKT' ? 'selected' : ''}>SKT</option>
              <option value="KT" ${phoneCarrier === 'KT' ? 'selected' : ''}>KT</option>
              <option value="LGU" ${phoneCarrier === 'LGU' ? 'selected' : ''}>LG U+</option>
              <option value="SKT알뜰" ${phoneCarrier === 'SKT알뜰' ? 'selected' : ''}>SKT알뜰</option>
              <option value="KT알뜰" ${phoneCarrier === 'KT알뜰' ? 'selected' : ''}>KT알뜰</option>
              <option value="LGU알뜰" ${phoneCarrier === 'LGU알뜰' ? 'selected' : ''}>LG U+알뜰</option>
            </select>
          </div>
          <div style='margin-bottom:20px;'><label class="editClientInfoTitle"><b>핸드폰번호:</b></label> 
            <input type='text' class='editClientInfoInputPhone first' id='edit-manager-phone1' value='${phone1}' maxlength='3' 
                   oninput="autoMoveToNext(this, 'edit-manager-phone2', 3)" onkeydown="handlePhoneBackspace(event, null, 'edit-manager-phone2')" /> -
            <input type='text' class='editClientInfoInputPhone middle' id='edit-manager-phone2' value='${phone2}' maxlength='4' 
                   oninput="autoMoveToNext(this, 'edit-manager-phone3', 4)" onkeydown="handlePhoneBackspace(event, 'edit-manager-phone1', 'edit-manager-phone3')" /> -
            <input type='text' class='editClientInfoInputPhone last' id='edit-manager-phone3' value='${phone3}' maxlength='4' 
                   oninput="autoMoveToNext(this, null, 4)" onkeydown="handlePhoneBackspace(event, 'edit-manager-phone2', null)" />
          </div>
          <div style='margin-bottom:20px;'><label class="editClientInfoTitle"><b>가이아:</b></label> <input type='text' class="editClientInfoInput" id='edit-manager-gaia-id' value='${manager.gaiaId || ''}' /></div>
          <div style='margin-bottom:20px;'><label class="editClientInfoTitle"><b>가이아 비밀번호:</b></label> <input type='text' class="editClientInfoInput" id='edit-manager-gaia-password' value='${decryptedCache.loaded.gaiaPassword ? (decryptedCache.gaiaPassword || "") : (manager.gaiaPassword && decryptedCache.isLoading ? "로딩 중..." : "")}' placeholder='비밀번호 입력' /></div>
          <div style='margin-bottom:20px;'>
            <label class="editClientInfoTitle" style='display:block; margin-bottom:5px;'><b>비고</b></label>
            <textarea class="editClientInfoInput" id='edit-manager-notes' placeholder='메모나 특이사항을 입력하세요' style='height:80px; resize:vertical; font-family:inherit; width:100%;'>${manager.notes || ''}</textarea>
          </div>
          
          <!-- 보험사 정보 섹션 -->
          <div style='margin-bottom:30px; border-top:2px solid #e9ecef; padding-top:20px;'>
            <h4 style='margin-bottom:20px; color:#2c3e50;'>보험사 계정 정보</h4>
            
            <!-- 생명보험사 -->
            <div style='margin-bottom:25px;'>
              <h5 style='margin-bottom:15px; color:#27ae60; font-size:16px;'>생명보험사</h5>
              <div id='life-insurance-fields'>
                ${lifeInsuranceCompanies.map(comp => {
                  const existing = manager.insuranceAccounts?.[comp.key] || {};
                  let passwordDisplay = '';
                  if (existing.password) {
                    passwordDisplay = decryptedCache.loaded.insurancePasswords.has(comp.key) ? (decryptedCache.insurancePasswords[comp.key] || '') : (decryptedCache.isLoading ? '로딩 중...' : '');
                  }
                  return `
                    <div style='display:flex; align-items:center; margin-bottom:10px; gap:8px;'>
                      <label style='width:120px; font-size:14px; color:#495057;'>${comp.name}:</label>
                      <input type='text' placeholder='사원번호' style='flex:1; padding:6px; border:1px solid #ddd; border-radius:4px; font-size:14px;' 
                             id='insurance-${comp.key}-id' value='${existing.employeeId || ''}' />
                      <input type='text' placeholder='비밀번호' style='flex:1; padding:6px; border:1px solid #ddd; border-radius:4px; font-size:14px;' 
                             id='insurance-${comp.key}-password' value='${passwordDisplay}' />
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
            
            <!-- 손해보험사 -->
            <div style='margin-bottom:20px;'>
              <h5 style='margin-bottom:15px; color:#3498db; font-size:16px;'>손해보험사</h5>
              <div id='nonlife-insurance-fields'>
                ${nonLifeInsuranceCompanies.map(comp => {
                  const existing = manager.insuranceAccounts?.[comp.key] || {};
                  let passwordDisplay = '';
                  if (existing.password) {
                    passwordDisplay = decryptedCache.loaded.insurancePasswords.has(comp.key) ? (decryptedCache.insurancePasswords[comp.key] || '') : (decryptedCache.isLoading ? '로딩 중...' : '');
                  }
                  return `
                    <div style='display:flex; align-items:center; margin-bottom:10px; gap:8px;'>
                      <label style='width:120px; font-size:14px; color:#495057;'>${comp.name}:</label>
                      <input type='text' placeholder='사원번호' style='flex:1; padding:6px; border:1px solid #ddd; border-radius:4px; font-size:14px;' 
                             id='insurance-${comp.key}-id' value='${existing.employeeId || ''}' />
                      <input type='text' placeholder='비밀번호' style='flex:1; padding:6px; border:1px solid #ddd; border-radius:4px; font-size:14px;' 
                             id='insurance-${comp.key}-password' value='${passwordDisplay}' />
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </div>
        </div>
        
        <div class='modal-footer' style='text-align:right;'>
          <button class='save-manager-btn modal-btn blue' style='margin-right:8px;'>저장</button>
          <button class='cancel-manager-btn modal-btn'>취소</button>
        </div>
      `;
      
      // x 버튼 다시 보이기 (편집 모드)
      const closeBtn = document.getElementById('closeModal');
      if (closeBtn) closeBtn.style.display = 'block';
      
      // 주민번호 숫자만 입력 제한
      const ssnFrontInput = document.getElementById('edit-manager-ssn-front');
      const ssnBackInput = document.getElementById('edit-manager-ssn-back');
      [ssnFrontInput, ssnBackInput].forEach(input => {
        if (input) {
          input.addEventListener('input', function(e) {
            this.value = this.value.replace(/[^0-9]/g, '');
          });
        }
      });
      
      // 핸드폰번호 숫자만 입력 제한
      const phoneInputs = [
        document.getElementById('edit-manager-phone1'),
        document.getElementById('edit-manager-phone2'),
        document.getElementById('edit-manager-phone3')
      ];
      phoneInputs.forEach(input => {
        if (input) {
          input.addEventListener('input', function(e) {
            this.value = this.value.replace(/[^0-9]/g, '');
          });
        }
      });
      
    }
    
    // 보험사 검색 기능은 setupInsuranceSearch 함수에서 따로 처리
    
    // 복호화는 메인 showManagerDetail 함수에서 처리
  }

  renderManagerDetail(false);
  
  // 모달 표시
  detailModal.style.display = 'flex';
  
  // ESC 키로 단계별 뒤로가기 - 기존 리스너 정리
  document.removeEventListener('keydown', window.currentManagerEscHandler);
  
  // 짧은 지연을 추가하여 모달 클래스 변경이 완료된 후 이벤트 리스너 설정
  setTimeout(() => {
  
  const handleManagerEscKey = (e) => {
    if (e.key === 'Escape') {
      const modalContent = document.querySelector('.modal-content');
      if (modalContent && modalContent.classList.contains('edit-modal')) {
        // 편집 모드에서 ESC: 보기 모드로 돌아가기
        renderManagerDetail(false);
      } else if (modalContent && modalContent.classList.contains('field-modal')) {
        // 개별 수정 모달에서 ESC: 담당자 상세로 돌아가기 (이미 개별 모달에서 처리됨)
        return;
      } else {
        // 보기 모드에서 ESC: 모달 완전히 닫기
        detailModal.style.display = "none";
        document.body.classList.remove('modal-open');
        document.removeEventListener('keydown', handleManagerEscKey);
        window.currentManagerEscHandler = null;
      }
    }
  };
  
  window.currentManagerEscHandler = handleManagerEscKey;
  document.addEventListener('keydown', handleManagerEscKey);
  
  }, 10); // setTimeout 종료
  
  // 복호화 작업을 백그라운드에서 실행 (처음에만)
  if (decryptedCache.isLoading && !decryptedCache.loaded.ssn && !decryptedCache.loaded.gaiaPassword && decryptedCache.loaded.insurancePasswords.size === 0) {
    startBackgroundDecryption(manager);
  } else {
    // 이미 캐시된 데이터가 있으면 즉시 로딩 완료 상태로 설정
    decryptedCache.isLoading = false;
  }

  // 백그라운드 복호화 함수 (캐시 최적화)
  function startBackgroundDecryption(manager) {
    setTimeout(async () => {
      try {
        // 주민등록번호 복호화
        if (manager.ssn && !decryptedCache.loaded.ssn) {
          try {
            const decryptedSSN = await decryptSSN(manager.ssn);
            decryptedCache.ssn = decryptedSSN || '';
            decryptedCache.loaded.ssn = true;
          } catch (e) {
            console.error('주민등록번호 복호화 실패:', e);
            decryptedCache.ssn = '';
            decryptedCache.loaded.ssn = true;
          }
        }
        
        // 가이아 비밀번호 복호화
        if (manager.gaiaPassword && !decryptedCache.loaded.gaiaPassword) {
          try {
            const decryptedPassword = await getDecryptedGaiaPassword(manager);
            decryptedCache.gaiaPassword = decryptedPassword || '';
            decryptedCache.loaded.gaiaPassword = true;
          } catch (e) {
            console.error('가이아 비밀번호 복호화 실패:', e);
            decryptedCache.gaiaPassword = '';
            decryptedCache.loaded.gaiaPassword = true;
          }
        }
        
        // 보험사 비밀번호 복호화
        if (manager.insuranceAccounts) {
          for (const [companyKey, account] of Object.entries(manager.insuranceAccounts)) {
            if (account.password && !decryptedCache.loaded.insurancePasswords.has(companyKey)) {
              try {
                const decryptedPassword = await decryptSSN(account.password);
                decryptedCache.insurancePasswords[companyKey] = decryptedPassword || '';
                decryptedCache.loaded.insurancePasswords.add(companyKey);
              } catch (e) {
                console.error(`보험사 ${companyKey} 비밀번호 복호화 실패:`, e);
                decryptedCache.insurancePasswords[companyKey] = '';
                decryptedCache.loaded.insurancePasswords.add(companyKey);
              }
            }
          }
        }
        
        // 캐시 로딩 완료
        decryptedCache.isLoading = false;
        
        // UI 업데이트 (현재 표시된 모드에 따라)
        updateUIWithCache();
        
      } catch (e) {
        console.error('비동기 데이터 로딩 실패:', e);
        decryptedCache.isLoading = false;
      }
    }, 0);
  }
  
  // 캐시된 데이터로 UI 업데이트
  function updateUIWithCache() {
    // 주민등록번호 업데이트
    if (decryptedCache.loaded.ssn) {
      const ssnDisplay = document.getElementById('ssn-display');
      if (ssnDisplay && ssnDisplay.textContent === "로딩 중...") {
        ssnDisplay.textContent = decryptedCache.ssn || '복호화 실패';
      }
      
      // edit 모드 주민등록번호 업데이트
      if (decryptedCache.ssn && decryptedCache.ssn.includes('-')) {
        const [ssnFront, ssnBack] = decryptedCache.ssn.split('-');
        const ssnFrontInput = document.getElementById('edit-manager-ssn-front');
        const ssnBackInput = document.getElementById('edit-manager-ssn-back');
        if (ssnFrontInput && ssnFrontInput.value === '로딩') {
          ssnFrontInput.value = ssnFront;
        }
        if (ssnBackInput && ssnBackInput.value === '중') {
          ssnBackInput.value = ssnBack;
        }
      }
    }
    
    // 가이아 비밀번호 업데이트
    if (decryptedCache.loaded.gaiaPassword) {
      const gaiaPasswordDisplay = document.getElementById('gaia-password-display');
      if (gaiaPasswordDisplay && gaiaPasswordDisplay.textContent === "로딩 중...") {
        gaiaPasswordDisplay.textContent = decryptedCache.gaiaPassword || '복호화 실패';
      }
      
      const passwordInput = document.getElementById('edit-manager-gaia-password');
      if (passwordInput && passwordInput.value === "로딩 중...") {
        passwordInput.value = decryptedCache.gaiaPassword || '';
      }
    }
    
    // 보험사 정보 업데이트
    const insuranceContainer = document.getElementById('insurance-accordion-container');
    if (insuranceContainer && insuranceContainer.textContent === "보험사 정보 로딩 중...") {
      const insuranceHtml = renderInsuranceAccordionWithCache(manager, decryptedCache);
      insuranceContainer.innerHTML = insuranceHtml;
    }
    
    // 보험사 비밀번호 업데이트 (edit 모드)
    for (const [companyKey, decryptedPassword] of Object.entries(decryptedCache.insurancePasswords)) {
      if (decryptedCache.loaded.insurancePasswords.has(companyKey)) {
        const passwordInput = document.getElementById(`insurance-${companyKey}-password`);
        if (passwordInput && passwordInput.value === '로딩 중...') {
          passwordInput.value = decryptedPassword || '';
        }
      }
    }
  }
  
  detailModal.style.display = "flex";
  document.body.classList.add('modal-open');
  
  // 배경 스크롤 방지
  document.body.classList.add('modal-open');

  // 모달창 스타일 넓히기 (담당자 정보용)
  if (detailModal) {
    const modalContent = detailModal.querySelector('.modal-content');
    modalContent.style.maxWidth = '700px';
    modalContent.style.width = '95vw';
    modalContent.style.maxHeight = '90vh';
    modalContent.style.overflowY = 'auto';
  }

  // 모달 내 버튼 이벤트 위임
  detailContent.onclick = async (e) => {
    if (e.target.classList.contains('password-reset-btn')) {
      // 비밀번호 초기화
      const managerId = e.target.getAttribute('data-manager-id');
      await resetManagerPassword(managerId);
    } else if (e.target.classList.contains('edit-manager-btn')) {
      renderManagerDetail(true);
    } else if (e.target.classList.contains('cancel-manager-btn')) {
      renderManagerDetail(false);
    } else if (e.target.classList.contains('insurance-edit-btn')) {
      // 개별 보험사 수정
      const companyKey = e.target.getAttribute('data-company');
      const companyName = e.target.getAttribute('data-company-name');
      showInsuranceEditModal(manager, companyKey, companyName);
    } else if (e.target.classList.contains('insurance-add-btn')) {
      // 보험사 등록
      const companyKey = e.target.getAttribute('data-company');
      const companyName = e.target.getAttribute('data-company-name');
      showInsuranceEditModal(manager, companyKey, companyName);
    } else if (e.target.classList.contains('accordion-header') || e.target.closest('.accordion-header')) {
      // 아코디언 토글 - 헤더 전체 영역 클릭 가능
      const headerElement = e.target.classList.contains('accordion-header') ? e.target : e.target.closest('.accordion-header');
      const target = headerElement.getAttribute('data-target');
      const content = document.getElementById(target + '-content');
      const icon = headerElement.querySelector('.accordion-icon');
      
      if (content && icon) {
        if (content.style.display === 'none') {
          content.style.display = 'block';
          icon.textContent = '▼';
          // 펼쳐질 때 border-radius 조정
          headerElement.style.borderRadius = '6px 6px 0 0';
        } else {
          content.style.display = 'none';
          icon.innerHTML = '<i class="fas fa-chevron-right"></i>';
          // 접힐 때 border-radius 조정  
          headerElement.style.borderRadius = '6px';
        }
      }
    } else if (e.target.classList.contains('field-edit-btn')) {
      // 개별 필드 수정
      const fieldType = e.target.getAttribute('data-field');
      showFieldEditModal(manager, fieldType);
    } else if (e.target.classList.contains('save-manager-btn')) {
      // 수정 저장
      const phoneCarrierValue = document.getElementById('edit-manager-phone-carrier').value;
      const phoneNumber = [
        document.getElementById('edit-manager-phone1').value,
        document.getElementById('edit-manager-phone2').value,
        document.getElementById('edit-manager-phone3').value
      ].join('-');
      
      // 담당자 페이지와 동일한 형태로 저장: "통신사 전화번호"
      const phone = phoneCarrierValue && phoneNumber && phoneNumber !== '--' 
        ? `${phoneCarrierValue} ${phoneNumber}` 
        : phoneNumber;
      
      const ssnFront = document.getElementById('edit-manager-ssn-front').value.trim();
      const ssnBack = document.getElementById('edit-manager-ssn-back').value.trim();
      
      // 가이아 정보 수집
      const gaiaId = document.getElementById('edit-manager-gaia-id').value;
      const gaiaPassword = document.getElementById('edit-manager-gaia-password').value;
      
      // 보험사 계정 정보 수집
      const insuranceAccounts = {};
      
      // 생명보험사 정보 수집
      lifeInsuranceCompanies.forEach(comp => {
        const employeeId = document.getElementById(`insurance-${comp.key}-id`).value.trim();
        const password = document.getElementById(`insurance-${comp.key}-password`).value.trim();
        const existing = manager.insuranceAccounts?.[comp.key] || {};
        
        if (employeeId || password) {
          insuranceAccounts[comp.key] = {
            employeeId: employeeId,
            password: password
          };
        }
      });
      
      // 손해보험사 정보 수집
      nonLifeInsuranceCompanies.forEach(comp => {
        const employeeId = document.getElementById(`insurance-${comp.key}-id`).value.trim();
        const password = document.getElementById(`insurance-${comp.key}-password`).value.trim();
        const existing = manager.insuranceAccounts?.[comp.key] || {};
        
        if (employeeId || password) {
          insuranceAccounts[comp.key] = {
            employeeId: employeeId,
            password: password
          };
        }
      });
      
      // 팀명 처리 (숫자만 입력받아서 '팀' 자동 추가)
      const teamInput = document.getElementById('edit-manager-team').value.trim();
      const teamValue = teamInput ? (teamInput.endsWith('팀') ? teamInput : teamInput + '팀') : '';
      
      const updateData = {
        name: document.getElementById('edit-manager-name').value,
        team: teamValue,
        role: document.getElementById('edit-manager-role').value,
        gaiaId: gaiaId,
        phone: phone,
        notes: document.getElementById('edit-manager-notes').value,
        insuranceAccounts: insuranceAccounts
      };
      
      // 가이아 비밀번호 처리
      if (gaiaPassword) {
        updateData.gaiaPassword = gaiaPassword;
      }
      
      try {
        // 암호화가 필요한 데이터가 있는지 확인 (주민번호, 가이아 비밀번호, 보험사 비밀번호)
        const hasEncryptionData = (ssnFront && ssnBack) || gaiaPassword || 
          Object.values(insuranceAccounts).some(account => account.password);
        
        if (hasEncryptionData) {
          // Firebase Functions를 통해 암호화하여 저장
          const saveManagerFunction = httpsCallable(functions, 'updateManagerInfo');
          
          let finalUpdateData = { ...updateData };
          
          // 주민번호 처리
          if (ssnFront && ssnBack) {
            if (ssnFront.length !== 6 || ssnBack.length !== 7) {
              alert('주민등록번호를 올바르게 입력해주세요.');
              return;
            }
            finalUpdateData.ssn = ssnFront + '-' + ssnBack;
          } else if (ssnFront || ssnBack) {
            alert('주민등록번호는 앞 6자리와 뒤 7자리를 모두 입력해야 합니다.');
            return;
          }
          
          // 담당자 ID와 함께 전송
          finalUpdateData.managerId = manager.id;
          finalUpdateData.code = manager.code;
          finalUpdateData.createdAt = manager.createdAt;
          
          // 담당자 업데이트 데이터 준비 완료
          
          await saveManagerFunction(finalUpdateData);
          alert('담당자 정보가 수정되었습니다.');
          
        } else {
          // 암호화 데이터 없이 일반 정보만 업데이트
          await updateDoc(doc(db, 'managers', manager.id), updateData);
          alert('담당자 정보가 수정되었습니다.');
        }
        
        // 주민등록번호가 새로 추가되었는지 확인 (기존에 없었는데 새로 입력된 경우)
        const hadSSNBefore = !!manager.ssn;
        const hasSSNNow = !!(ssnFront && ssnBack);
        
        // 로컬 매니저 객체 업데이트
        Object.assign(manager, updateData);
        
        if (!hadSSNBefore && hasSSNNow) {
          // 주민번호가 새로 추가된 경우에만 페이지 새로고침을 권장
          alert('주민등록번호가 추가되었습니다. 페이지를 새로고침하여 최신 정보를 확인하세요.');
        }
        
        renderManagerDetail(false);
      } catch (err) {
        console.error('담당자 정보 수정 실패:', err);
        alert('담당자 정보 수정에 실패했습니다: ' + (err.message || err));
      }
    }
  };
  
  // 보험사 검색 기능 설정 (지연 실행으로 DOM 로드 대기)
  setTimeout(() => {
    setupInsuranceSearch();
  }, 100);
  
}

// 보험사 검색 기능 통합 함수
function setupInsuranceSearch() {
  const insuranceSearchInput = document.getElementById('insurance-search');
  if (!insuranceSearchInput) {
    // DOM이 아직 로드되지 않았으면 다시 시도
    setTimeout(() => {
      setupInsuranceSearch();
    }, 100);
    return;
  }
  
  // 기존 이벤트 리스너 제거
  const newSearchInput = insuranceSearchInput.cloneNode(true);
  insuranceSearchInput.parentNode.replaceChild(newSearchInput, insuranceSearchInput);
  
  newSearchInput.addEventListener('input', function() {
    const searchTerm = this.value.toLowerCase();
    const insuranceItems = document.querySelectorAll('.insurance-item');
    
    insuranceItems.forEach(item => {
      const companyName = item.getAttribute('data-company-name')?.toLowerCase() || '';
      if (companyName.includes(searchTerm)) {
        item.style.display = 'flex';
      } else {
        item.style.display = 'none';
      }
    });
    
    // 검색 결과에 따라 아코디언 자동 조절
    const lifeContent = document.getElementById('life-insurance-content');
    const nonlifeContent = document.getElementById('nonlife-insurance-content');
    const lifeIcon = document.querySelector('[data-target="life-insurance"] .accordion-icon');
    const nonlifeIcon = document.querySelector('[data-target="nonlife-insurance"] .accordion-icon');
    
    if (searchTerm) {
      // 검색 중일 때는 결과가 있는 섹션만 펼치기
      const lifeHasResults = lifeContent?.querySelector('.insurance-item[style*="flex"]');
      const nonlifeHasResults = nonlifeContent?.querySelector('.insurance-item[style*="flex"]');
      
      const lifeHeader = document.querySelector('[data-target="life-insurance"]');
      const nonlifeHeader = document.querySelector('[data-target="nonlife-insurance"]');
      
      if (lifeHasResults && lifeContent) {
        lifeContent.style.display = 'block';
        if (lifeIcon) lifeIcon.textContent = '▼';
        if (lifeHeader) lifeHeader.style.borderRadius = '6px 6px 0 0';
      } else if (lifeContent) {
        lifeContent.style.display = 'none';
        if (lifeIcon) lifeIcon.innerHTML = '<i class="fas fa-chevron-right"></i>';
        if (lifeHeader) lifeHeader.style.borderRadius = '6px';
      }
      
      if (nonlifeHasResults && nonlifeContent) {
        nonlifeContent.style.display = 'block';
        if (nonlifeIcon) nonlifeIcon.textContent = '▼';
        if (nonlifeHeader) nonlifeHeader.style.borderRadius = '6px 6px 0 0';
      } else if (nonlifeContent) {
        nonlifeContent.style.display = 'none';
        if (nonlifeIcon) nonlifeIcon.innerHTML = '<i class="fas fa-chevron-right"></i>';
        if (nonlifeHeader) nonlifeHeader.style.borderRadius = '6px';
      }
    } else {
      // 검색어가 없으면 모든 아이템 표시하고 아코디언을 기본 닫힌 상태로 복원
      insuranceItems.forEach(item => {
        item.style.display = 'flex';
      });
      
      const lifeHeader = document.querySelector('[data-target="life-insurance"]');
      const nonlifeHeader = document.querySelector('[data-target="nonlife-insurance"]');
      
      if (lifeContent) {
        lifeContent.style.display = 'none';
        if (lifeIcon) lifeIcon.innerHTML = '<i class="fas fa-chevron-right"></i>';
        if (lifeHeader) lifeHeader.style.borderRadius = '6px';
      }
      if (nonlifeContent) {
        nonlifeContent.style.display = 'none';
        if (nonlifeIcon) nonlifeIcon.innerHTML = '<i class="fas fa-chevron-right"></i>';
        if (nonlifeHeader) nonlifeHeader.style.borderRadius = '6px';
      }
    }
  });
}

// 클립보드 복사 함수를 전역으로 노출
window.copyToClipboard = function(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('링크가 복사되었습니다!');
  }).catch(() => {
    alert('복사에 실패했습니다.');
  });
};

// 모달 클래스 정리 함수 (페이지 전환 시 호출)
function cleanupModalClasses() {
  const modal = document.getElementById('detailModal');
  if (modal) {
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) {
      // 모든 모달 관련 클래스 제거 (고객정보조회 모달 클래스도 포함)
      modalContent.classList.remove('view-modal', 'edit-modal', 'field-modal', 'client-modal');
      // 모달 숨기기
      modal.style.display = 'none';
    }
  }
}

// 사이드 메뉴 전환 기능
function initMenuSwitch() {
  const menuManagers = document.getElementById('menu-managers');
  const menuManagerInfo = document.getElementById('menu-manager-info');
  const menuClients = document.getElementById('menu-clients');
  const menuExamSchedule = document.getElementById('menu-exam-schedule');
  const menuApplicants = document.getElementById('menu-applicants');
  const managerSection = document.getElementById('manager-section');
  const managerInfoSection = document.getElementById('manager-info-section');
  const clientSection = document.getElementById('client-section');
  const examScheduleSection = document.getElementById('exam-schedule-section');
  const applicantsSection = document.getElementById('applicants-section');
  const sidebar = document.getElementById('sidebar');
  const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  
  // 모바일 사이드바 닫기 함수
  const closeMobileSidebar = () => {
    sidebar.classList.remove('open');
    if (mobileMenuToggle) mobileMenuToggle.classList.remove('active');
    if (sidebarOverlay) sidebarOverlay.style.display = 'none';
  };

  if (!menuManagers || !menuManagerInfo || !menuClients || !menuExamSchedule || !menuApplicants || !managerSection || !managerInfoSection || !clientSection || !examScheduleSection || !applicantsSection || !sidebar) return;

  menuManagers.addEventListener('click', () => {
    // localStorage에 현재 섹션 저장
    localStorage.setItem("adminActiveSection", "managers");
    
    // 모달 클래스 정리
    cleanupModalClasses();
    
    menuManagers.classList.add('active');
    menuManagerInfo.classList.remove('active');
    menuClients.classList.remove('active');
    menuExamSchedule.classList.remove('active');
    menuApplicants.classList.remove('active');
    managerSection.style.display = '';
    managerInfoSection.style.display = 'none';
    clientSection.style.display = 'none';
    examScheduleSection.style.display = 'none';
    applicantsSection.style.display = 'none';
    closeMobileSidebar();
    
    // 담당자 정보 조회 검색창 초기화 및 전체 데이터 표시
    const managerSearchInput = document.getElementById('managerSearchInput');
    if (managerSearchInput) {
      managerSearchInput.value = '';
      renderManagerCards(managers, true); // 전체 담당자 데이터 표시
    }
    
    // 고객 정보 관리 검색창 초기화 및 전체 데이터 표시
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.value = '';
      renderCards(allClients, true); // 전체 고객 데이터 표시
    }
  });
  
  menuManagerInfo.addEventListener('click', () => {
    // localStorage에 현재 섹션 저장
    localStorage.setItem("adminActiveSection", "manager-info");
    
    // 모달 클래스 정리
    cleanupModalClasses();
    
    menuManagers.classList.remove('active');
    menuManagerInfo.classList.add('active');
    menuClients.classList.remove('active');
    menuExamSchedule.classList.remove('active');
    menuApplicants.classList.remove('active');
    managerSection.style.display = 'none';
    managerInfoSection.style.display = '';
    clientSection.style.display = 'none';
    examScheduleSection.style.display = 'none';
    applicantsSection.style.display = 'none';
    closeMobileSidebar();
    
    // 고객 정보 관리 검색창 초기화 및 전체 데이터 표시
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.value = '';
      renderCards(allClients, true); // 전체 고객 데이터 표시
    }
    
    // 담당자 정보 조회 페이지 진입 시 담당자 카드 렌더링
    setTimeout(() => {
      renderManagerCards(managers, true);
    }, 100); // 약간의 지연을 주어 managers 데이터가 로드되도록 함
  });
  
  menuClients.addEventListener('click', () => {
    // localStorage에 현재 섹션 저장
    localStorage.setItem("adminActiveSection", "clients");
    
    // 모달 클래스 정리
    cleanupModalClasses();
    
    menuManagers.classList.remove('active');
    menuManagerInfo.classList.remove('active');
    menuClients.classList.add('active');
    menuExamSchedule.classList.remove('active');
    menuApplicants.classList.remove('active');
    managerSection.style.display = 'none';
    managerInfoSection.style.display = 'none';
    clientSection.style.display = '';
    examScheduleSection.style.display = 'none';
    applicantsSection.style.display = 'none';
    closeMobileSidebar();
    
    // 담당자 정보 조회 검색창 초기화 및 전체 데이터 표시
    const managerSearchInput = document.getElementById('managerSearchInput');
    if (managerSearchInput) {
      managerSearchInput.value = '';
      renderManagerCards(managers, true); // 전체 담당자 데이터 표시
    }
    
    // 고객 정보 관리 페이지 진입 시 전체 고객 데이터 표시
    renderCards(allClients, true);
  });

  // 자격시험 일정 메뉴 클릭 이벤트
  menuExamSchedule.addEventListener('click', () => {
    // localStorage에 현재 섹션 저장
    localStorage.setItem("adminActiveSection", "exam-schedule");
    
    // 모달 클래스 정리
    cleanupModalClasses();
    
    menuManagers.classList.remove('active');
    menuManagerInfo.classList.remove('active');
    menuClients.classList.remove('active');
    menuExamSchedule.classList.add('active');
    menuApplicants.classList.remove('active');
    managerSection.style.display = 'none';
    managerInfoSection.style.display = 'none';
    clientSection.style.display = 'none';
    examScheduleSection.style.display = '';
    applicantsSection.style.display = 'none';
    closeMobileSidebar();
    
    // 자격시험 일정 페이지 진입 시 컴포넌트 초기화
    setTimeout(() => {
      initializeExamSchedule();
    }, 100);
  });

  menuApplicants.addEventListener('click', () => {
    // localStorage에 현재 섹션 저장
    localStorage.setItem("adminActiveSection", "applicants");
    
    // 모달 클래스 정리
    cleanupModalClasses();
    
    menuManagers.classList.remove('active');
    menuManagerInfo.classList.remove('active');
    menuClients.classList.remove('active');
    menuExamSchedule.classList.remove('active');
    menuApplicants.classList.add('active');
    managerSection.style.display = 'none';
    managerInfoSection.style.display = 'none';
    clientSection.style.display = 'none';
    examScheduleSection.style.display = 'none';
    applicantsSection.style.display = '';
    closeMobileSidebar();
    
    // 위촉자 조회 페이지 진입 시 컴포넌트 초기화
    setTimeout(() => {
      initializeApplicantViewer();
    }, 100);
  });
}

// 무한 스크롤로 Firestore에서 고객 데이터 페이지 단위로 불러오기
async function loadMoreClients() {
  if (isLoadingClients) return;
  isLoadingClients = true;
  let q;
  if (lastVisible) {
    q = query(fsCollection(db, "client_info"), orderBy("created_at", "desc"), startAfter(lastVisible), limit(PAGE_SIZE));
  } else {
    q = query(fsCollection(db, "client_info"), orderBy("created_at", "desc"), limit(PAGE_SIZE));
  }
  const snapshot = await getDocs(q);
  const newClients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  if (newClients.length > 0) {
    pagedClients = pagedClients.concat(newClients);
    lastVisible = snapshot.docs[snapshot.docs.length - 1];
    renderCards(pagedClients);
  }
  isLoadingClients = false;
}

// 스크롤 이벤트로 바닥에 닿으면 loadMoreClients 호출
function setupInfiniteScroll() {
  const mainContent = document.getElementById('main-content');
  if (!mainContent) return;
  mainContent.addEventListener('scroll', () => {
    if (mainContent.scrollTop + mainContent.clientHeight >= mainContent.scrollHeight - 10) {
      if (!searchInput.value.trim()) {
        loadMoreClients();
      }
    }
  });
}

// listenClients 함수 수정: 인증 상태 확인 추가
function listenClients() {
  if (!auth.currentUser) {
    return;
  }
  // created_at 내림차순 정렬 쿼리 적용
  const q = query(fsCollection(db, "client_info"), orderBy("created_at", "desc"));
  onSnapshot(q, (snapshot) => {
    allClients = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    renderCards(allClients, true);
  });
}

// 개별 보험사 수정 모달
async function showInsuranceEditModal(manager, companyKey, companyName) {
  // 보험사 개별 수정 모달용 클래스를 한 번에 변경
  const modalContent = document.querySelector('.modal-content');
  if (modalContent) {
    modalContent.className = modalContent.className.replace(/\b(edit-modal|view-modal|field-modal)\b/g, '') + ' field-modal';
  }
  
  const existing = manager.insuranceAccounts?.[companyKey] || {};
  const isEditMode = !!existing.employeeId; // 사원번호가 있으면 수정 모드
  
  // 캐시된 데이터 확인 후 기존 비밀번호 처리
  const managerId = manager.id || manager.name;
  const currentCache = managerDecryptionCache[managerId];
  let currentPassword = '';
  
  if (existing.password) {
    if (currentCache && currentCache.loaded.insurancePasswords.has(companyKey)) {
      // 캐시된 데이터가 있으면 즉시 표시
      currentPassword = currentCache.insurancePasswords[companyKey] || '';
    } else {
      // 캐시가 없으면 로딩 표시
      currentPassword = '로딩 중...';
    }
  }
  
  const modalHtml = `
    <div style="text-align: center; margin-bottom: 20px;">
      <h3 style="color: #2c3e50; margin-bottom: 10px;">${companyName} ${isEditMode ? '수정' : '등록'}</h3>
      <p style="color: #666; font-size: 14px;">담당자: ${manager.name}</p>
    </div>
    
    ${isEditMode ? '' : `
      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 8px; font-weight: bold;">사원번호:</label>
        <input type="text" id="insurance-modal-employeeId" value="${existing.employeeId || ''}" 
               style="width: 100%; max-width: 400px; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 16px; box-sizing: border-box;" />
      </div>
    `}
    
    <div style="margin-bottom: 20px;">
      <label style="display: block; margin-bottom: 8px; font-weight: bold;">비밀번호:</label>
      <input type="text" id="insurance-modal-password" value="${currentPassword}" 
             style="width: 100%; max-width: 400px; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 16px; box-sizing: border-box;" />
    </div>
    
    <div style="text-align: right; margin-top: 24px;">
      <button class="modal-btn" id="insurance-modal-cancel" style="margin-right: 8px;">취소</button>
      <button class="modal-btn blue" id="insurance-modal-save">저장</button>
    </div>
  `;
  
  detailContent.innerHTML = modalHtml;
  
  // x 버튼 숨기기 (개별 수정 모달에서는 취소 버튼 사용)
  const closeBtn = document.getElementById('closeModal');
  if (closeBtn) closeBtn.style.display = 'none';
  
  // 키보드 이벤트 리스너 추가
  const employeeIdInput = document.getElementById('insurance-modal-employeeId');
  const passwordInput = document.getElementById('insurance-modal-password');
  
  // 등록 모드면 사원번호에, 수정 모드면 비밀번호에 포커스
  const focusInput = isEditMode ? passwordInput : employeeIdInput || passwordInput;
  if (focusInput) {
    focusInput.focus();
  }
  
  // 두 입력란 모두에 키보드 이벤트 추가
  [employeeIdInput, passwordInput].forEach(input => {
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          document.getElementById('insurance-modal-save').click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          document.getElementById('insurance-modal-cancel').click();
        }
      });
    }
  });
  
  // 버튼 이벤트 리스너
  document.getElementById('insurance-modal-cancel').onclick = () => {
    showManagerDetail(manager); // 원래 담당자 상세로 돌아가기
  };
  
  document.getElementById('insurance-modal-save').onclick = async () => {
    const employeeIdInput = document.getElementById('insurance-modal-employeeId');
    const passwordInput = document.getElementById('insurance-modal-password');
    
    const employeeId = employeeIdInput ? employeeIdInput.value.trim() : existing.employeeId || '';
    const password = passwordInput.value.trim();
    
    try {
      // 업데이트할 보험사 계정 정보
      const updatedInsuranceAccounts = { ...manager.insuranceAccounts };
      
      if (employeeId || password) {
        // 사원번호나 비밀번호 중 하나라도 있으면 저장
        updatedInsuranceAccounts[companyKey] = {
          employeeId: employeeId,
          password: password
        };
      } else {
        // 둘 다 비어있으면 해당 보험사 정보 삭제
        delete updatedInsuranceAccounts[companyKey];
      }
      
      // Firebase Functions를 통해 업데이트
      const updateManagerFunction = httpsCallable(functions, 'updateManagerInfo');
      await updateManagerFunction({
        managerId: manager.id,
        insuranceAccounts: updatedInsuranceAccounts,
        code: manager.code,
        createdAt: manager.createdAt
      });
      
      // 로컬 매니저 객체 업데이트
      manager.insuranceAccounts = updatedInsuranceAccounts;
      
      alert(`${companyName} 계정 정보가 수정되었습니다.`);
      showManagerDetail(manager); // 원래 담당자 상세로 돌아가기
      
    } catch (err) {
      console.error('보험사 계정 수정 실패:', err);
      alert('보험사 계정 수정에 실패했습니다: ' + (err.message || err));
    }
  };
  
  // 캐시 확인 후 비동기 복호화 (필요한 경우에만)
  if (existing.password && (!currentCache || !currentCache.loaded.insurancePasswords.has(companyKey))) {
    setTimeout(async () => {
      try {
        const decryptedPassword = await decryptSSN(existing.password);
        // 캐시 업데이트
        if (currentCache) {
          currentCache.insurancePasswords[companyKey] = decryptedPassword || '';
          currentCache.loaded.insurancePasswords.add(companyKey);
        }
        const passwordInput = document.getElementById('insurance-modal-password');
        if (passwordInput && passwordInput.value === '로딩 중...') {
          passwordInput.value = decryptedPassword || '';
        }
      } catch (e) {
        console.error('보험사 비밀번호 복호화 실패:', e);
        // 캐시에 빈 값으로 저장
        if (currentCache) {
          currentCache.insurancePasswords[companyKey] = '';
          currentCache.loaded.insurancePasswords.add(companyKey);
        }
        const passwordInput = document.getElementById('insurance-modal-password');
        if (passwordInput && passwordInput.value === '로딩 중...') {
          passwordInput.value = '';
        }
      }
    }, 0);
  }
}

// 개별 필드 수정 모달
async function showFieldEditModal(manager, fieldType) {
  // 개별 수정 모달용 클래스를 한 번에 변경
  const modalContent = document.querySelector('.modal-content');
  if (modalContent) {
    modalContent.className = modalContent.className.replace(/\b(edit-modal|view-modal|field-modal)\b/g, '') + ' field-modal';
  }
  
  let modalHtml = '';
  let fieldLabel = '';
  
  switch (fieldType) {
    case 'team':
      fieldLabel = '팀';
      modalHtml = `
        <div style="text-align: center; margin-bottom: 20px;">
          <h3 style="color: #2c3e50; margin-bottom: 10px;">팀 수정</h3>
          <p style="color: #666; font-size: 14px;">담당자: ${manager.name}</p>
        </div>
        
        <div style="margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <label style="font-weight: bold; margin: 0;">팀:</label>
            <input type="text" id="field-modal-input" value="${manager.team && manager.team.endsWith('팀') ? manager.team.slice(0, -1) : manager.team || ''}" placeholder="숫자만 입력 (예: 3)"
                   style="flex: 1; max-width: 200px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;" />
            <span style="font-weight: bold; color: #2c3e50;">팀</span>
          </div>
          <div style="font-size: 12px; color: #666;">※ 숫자만 입력하면 자동으로 '팀'이 붙습니다</div>
        </div>
      `;
      break;
      
    case 'role':
      fieldLabel = '직급';
      modalHtml = `
        <div style="text-align: center; margin-bottom: 20px;">
          <h3 style="color: #2c3e50; margin-bottom: 10px;">직급 수정</h3>
          <p style="color: #666; font-size: 14px;">담당자: ${manager.name}</p>
        </div>
        
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; font-weight: bold;">직급:</label>
          <select id="field-modal-input" style="width: 100%; max-width: 250px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;">
            <option value="">직급 선택</option>
            <option value="BM" ${manager.role === 'BM' ? 'selected' : ''}>BM</option>
            <option value="ABM" ${manager.role === 'ABM' ? 'selected' : ''}>ABM</option>
            <option value="SM" ${manager.role === 'SM' ? 'selected' : ''}>SM</option>
            <option value="ASM" ${manager.role === 'ASM' ? 'selected' : ''}>ASM</option>
            <option value="팀장" ${manager.role === '팀장' ? 'selected' : ''}>팀장</option>
          </select>
        </div>
      `;
      break;
      
    case 'phone':
      // 핸드폰번호에서 통신사와 전화번호 분리 (전체 수정 모달과 동일한 로직)
      let fieldPhoneCarrier = '';
      let fieldPhoneNumber = manager.phone || '';
      
      // "SKT 010-5540-5543" 형태에서 통신사와 전화번호 분리
      if (fieldPhoneNumber.includes(' ') && fieldPhoneNumber.match(/^[A-Z가-힣]+\s/)) {
        const parts = fieldPhoneNumber.split(' ');
        fieldPhoneCarrier = parts[0];
        fieldPhoneNumber = parts.slice(1).join(' ');
      }
      
      const phoneParts = fieldPhoneNumber ? fieldPhoneNumber.split('-') : ['', '', ''];
      fieldLabel = '핸드폰번호';
      modalHtml = `
        <div style="text-align: center; margin-bottom: 20px;">
          <h3 style="color: #2c3e50; margin-bottom: 10px;">핸드폰번호 수정</h3>
          <p style="color: #666; font-size: 14px;">담당자: ${manager.name}</p>
        </div>
        
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; font-weight: bold;">통신사:</label>
          <select id="field-modal-carrier" style="width: 100%; max-width: 280px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
            <option value="">통신사</option>
            <option value="SKT" ${fieldPhoneCarrier === 'SKT' ? 'selected' : ''}>SKT</option>
            <option value="KT" ${fieldPhoneCarrier === 'KT' ? 'selected' : ''}>KT</option>
            <option value="LGU" ${fieldPhoneCarrier === 'LGU' ? 'selected' : ''}>LG U+</option>
            <option value="SKT알뜰" ${fieldPhoneCarrier === 'SKT알뜰' ? 'selected' : ''}>SKT알뜰</option>
            <option value="KT알뜰" ${fieldPhoneCarrier === 'KT알뜰' ? 'selected' : ''}>KT알뜰</option>
            <option value="LGU알뜰" ${fieldPhoneCarrier === 'LGU알뜰' ? 'selected' : ''}>LG U+알뜰</option>
          </select>
        </div>
        
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; font-weight: bold;">핸드폰번호:</label>
          <div style="display: flex; gap: 8px; align-items: center; max-width: 280px;">
            <input type="text" id="field-modal-phone1" value="${phoneParts[0] || ''}" maxlength="3" placeholder="010"
                   style="width: 50px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; text-align: center;" 
                   oninput="autoMoveToNext(this, 'field-modal-phone2', 3)" onkeydown="handlePhoneBackspace(event, null, 'field-modal-phone2')" />
            <span style="color: #666;">-</span>
            <input type="text" id="field-modal-phone2" value="${phoneParts[1] || ''}" maxlength="4" placeholder="1234"
                   style="width: 65px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; text-align: center;" 
                   oninput="autoMoveToNext(this, 'field-modal-phone3', 4)" onkeydown="handlePhoneBackspace(event, 'field-modal-phone1', 'field-modal-phone3')" />
            <span style="color: #666;">-</span>
            <input type="text" id="field-modal-phone3" value="${phoneParts[2] || ''}" maxlength="4" placeholder="5678"
                   style="width: 65px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; text-align: center;" 
                   oninput="autoMoveToNext(this, null, 4)" onkeydown="handlePhoneBackspace(event, 'field-modal-phone2', null)" />
          </div>
        </div>
      `;
      break;
      
    case 'gaiaPassword':
      fieldLabel = '가이아 비밀번호';
      
      // 암호화된 비밀번호가 없으면 바로 빈 값으로 표시
      if (!manager.gaiaPassword) {
        modalHtml = `
          <div style="text-align: center; margin-bottom: 20px;">
            <h3 style="color: #2c3e50; margin-bottom: 10px;">가이아 비밀번호 수정</h3>
            <p style="color: #666; font-size: 14px;">담당자: ${manager.name}</p>
          </div>
          
          <div style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 8px; font-weight: bold;">가이아 비밀번호:</label>
            <input type="text" id="field-modal-input" value="" placeholder="가이아 비밀번호"
                   style="width: 100%; max-width: 250px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;" />
          </div>
        `;
      } else {
        modalHtml = `
          <div style="text-align: center; margin-bottom: 20px;">
            <h3 style="color: #2c3e50; margin-bottom: 10px;">가이아 비밀번호 수정</h3>
            <p style="color: #666; font-size: 14px;">담당자: ${manager.name}</p>
          </div>
          
          <div style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 8px; font-weight: bold;">가이아 비밀번호:</label>
            <input type="text" id="field-modal-input" value="로딩 중..." readonly placeholder="가이아 비밀번호"
                   style="width: 100%; max-width: 250px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;" />
          </div>
        `;
        
        // 캐시된 데이터 확인 후 복호화 처리
        const managerId = manager.id || manager.name;
        const currentCache = managerDecryptionCache[managerId];
        
        if (currentCache && currentCache.loaded.gaiaPassword) {
          // 캐시된 데이터가 있으면 즉시 표시 (복호화 건너뛰기)
          setTimeout(() => {
            const input = document.getElementById('field-modal-input');
            if (input) {
              input.value = currentCache.gaiaPassword || '';
              input.removeAttribute('readonly');
            }
          }, 0);
        } else {
          // 캐시가 없으면 복호화 후 캐시 업데이트
          setTimeout(async () => {
            let currentGaiaPassword = '';
            try {
              currentGaiaPassword = await decryptSSN(manager.gaiaPassword);
              // 캐시 업데이트
              if (currentCache) {
                currentCache.gaiaPassword = currentGaiaPassword;
                currentCache.loaded.gaiaPassword = true;
              }
            } catch (e) {
              currentGaiaPassword = '';
              if (currentCache) {
                currentCache.gaiaPassword = '';
                currentCache.loaded.gaiaPassword = true;
              }
            }
            const input = document.getElementById('field-modal-input');
            if (input) {
              input.value = currentGaiaPassword;
              input.removeAttribute('readonly');
            }
          }, 0);
        }
      }
      break;
      
    default:
      alert('지원하지 않는 필드입니다.');
      return;
  }
  
  modalHtml += `
    <div style="text-align: right; margin-top: 24px;">
      <button class="modal-btn" id="field-modal-cancel" style="margin-right: 8px;">취소</button>
      <button class="modal-btn blue" id="field-modal-save">저장</button>
    </div>
  `;
  
  detailContent.innerHTML = modalHtml;
  
  // x 버튼 숨기기 (개별 수정 모달에서는 취소 버튼 사용)
  const closeBtn = document.getElementById('closeModal');
  if (closeBtn) closeBtn.style.display = 'none';
  
  // 키보드 이벤트 리스너 추가
  const fieldInput = document.getElementById('field-modal-input');
  if (fieldInput) {
    fieldInput.focus(); // 입력란에 포커스
    fieldInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('field-modal-save').click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('field-modal-cancel').click();
      }
    });
  }
  
  // 핸드폰번호 모달의 세 개 입력란에 대한 키보드 이벤트 리스너 추가
  const phone1Input = document.getElementById('field-modal-phone1');
  const phone2Input = document.getElementById('field-modal-phone2');
  const phone3Input = document.getElementById('field-modal-phone3');
  
  [phone1Input, phone2Input, phone3Input].forEach(input => {
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          document.getElementById('field-modal-save').click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          document.getElementById('field-modal-cancel').click();
        }
      });
    }
  });
  
  // 핸드폰번호 모달에서 첫 번째 입력란에 포커스
  if (phone1Input) {
    phone1Input.focus();
  }
  
  // 버튼 이벤트 리스너
  document.getElementById('field-modal-cancel').onclick = () => {
    showManagerDetail(manager); // 원래 담당자 상세로 돌아가기
  };
  
  document.getElementById('field-modal-save').onclick = async () => {
    try {
      let updateData = {};
      
      switch (fieldType) {
        case 'team':
          let teamValue = document.getElementById('field-modal-input').value.trim();
          if (teamValue && !teamValue.endsWith('팀')) {
            teamValue += '팀';
          }
          updateData.team = teamValue;
          break;
          
        case 'role':
          updateData.role = document.getElementById('field-modal-input').value.trim();
          break;
          
        case 'phone':
          const phone1 = document.getElementById('field-modal-phone1').value.trim();
          const phone2 = document.getElementById('field-modal-phone2').value.trim();
          const phone3 = document.getElementById('field-modal-phone3').value.trim();
          const carrier = document.getElementById('field-modal-carrier').value;
          
          if (phone1 && phone2 && phone3) {
            // 담당자 페이지와 동일한 형태로 저장: "통신사 전화번호"
            const phoneNumber = `${phone1}-${phone2}-${phone3}`;
            updateData.phone = carrier && carrier.trim() 
              ? `${carrier} ${phoneNumber}` 
              : phoneNumber;
          } else if (!phone1 && !phone2 && !phone3) {
            updateData.phone = '';
          } else {
            alert('핸드폰번호를 완전히 입력하거나 모두 비워주세요.');
            return;
          }
          break;
          
        case 'gaiaPassword':
          const gaiaPassword = document.getElementById('field-modal-input').value.trim();
          if (gaiaPassword) {
            updateData.gaiaPassword = gaiaPassword;
          }
          break;
      }
      
      // Firebase Functions를 통해 업데이트
      const updateManagerFunction = httpsCallable(functions, 'updateManagerInfo');
      await updateManagerFunction({
        managerId: manager.id,
        ...updateData,
        code: manager.code,
        createdAt: manager.createdAt
      });
      
      // 로컬 매니저 객체 업데이트
      Object.assign(manager, updateData);
      
      alert(`${fieldLabel}이(가) 수정되었습니다.`);
      showManagerDetail(manager); // 원래 담당자 상세로 돌아가기
      
    } catch (err) {
      console.error(`${fieldLabel} 수정 실패:`, err);
      alert(`${fieldLabel} 수정에 실패했습니다: ` + (err.message || err));
    }
  };
}

// 일괄 비밀번호 설정 함수
window.setupBulkPasswords = async function() {
  if (!window.confirm('⚠️ 기존 담당자들의 비밀번호를 일괄 설정하시겠습니까?\n\n- 기본 비밀번호: 0000\n- 이미 비밀번호가 있는 담당자는 건너뜁니다\n- 비밀번호가 없는 담당자만 설정됩니다\n\n계속하시겠습니까?')) {
    return;
  }

  try {
    // 현재 사용자 인증 상태 확인
    const currentUser = auth.currentUser;
    if (!currentUser) {
      alert('로그인이 필요합니다. 다시 로그인해주세요.');
      return;
    }

    const bulkBtn = document.getElementById('bulkPasswordBtn');
    const originalText = bulkBtn.innerHTML;
    bulkBtn.disabled = true;
    bulkBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 설정 중...';

    // Firebase Functions 호출
    const setupBulkManagerPasswords = httpsCallable(functions, 'setupBulkManagerPasswords');
    const result = await setupBulkManagerPasswords();

    const resultData = result.data;
    
    let message = `✅ 일괄 비밀번호 설정 완료!\n\n`;
    message += `총 담당자: ${resultData.total}명\n`;
    message += `비밀번호 설정: ${resultData.processed}명\n`;
    message += `이미 설정됨: ${resultData.skipped}명\n`;
    if (resultData.errors > 0) {
      message += `오류: ${resultData.errors}명\n`;
    }
    message += `\n기본 비밀번호: ${resultData.defaultPassword}`;

    alert(message);

  } catch (error) {
    console.error('일괄 비밀번호 설정 실패:', error);
    let errorMessage = '일괄 비밀번호 설정에 실패했습니다.';
    
    if (error.code === 'functions/permission-denied') {
      errorMessage = '권한이 없습니다. 관리자로 로그인해주세요.';
    } else if (error.code === 'functions/unauthenticated') {
      errorMessage = '인증이 필요합니다. 다시 로그인해주세요.';
    }
    
    alert(`❌ ${errorMessage}\n\n${error.message || error}`);
  } finally {
    const bulkBtn = document.getElementById('bulkPasswordBtn');
    bulkBtn.disabled = false;
    bulkBtn.innerHTML = '<i class="fas fa-users-cog"></i> 기존 담당자 비밀번호 일괄 설정';
  }
};

// 관리자 페이지 우편번호 검색 팝업 열기
window.openAdminPostcodeSearch = function openAdminPostcodeSearch() {
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
      const postcodeField = document.getElementById('edit-postcode');
      const addressField = document.getElementById('edit-address');
      
      if (postcodeField) {
        postcodeField.value = data.zonecode;
      }
      
      if (addressField) {
        addressField.value = addr + extraAddr;
      }
      
      // 상세주소 필드로 포커스 이동 (있는 경우)
      const addressDetailField = document.getElementById('edit-addressDetail');
      if (addressDetailField) {
        addressDetailField.focus();
      }
    }
  }).open();
};

// 담당자 비밀번호 초기화 함수
async function resetManagerPassword(managerId) {
  if (!confirm('담당자의 비밀번호를 초기화하시겠습니까?\n\n초기화 후 비밀번호: 0000\n담당자는 해당 비밀번호로 로그인 후 변경할 수 있습니다.')) {
    return;
  }
  
  try {
    // Firebase Functions 호출
    const setManagerPassword = httpsCallable(functions, 'setManagerPassword');
    const result = await setManagerPassword({
      managerId: managerId,
      password: '0000'
    });
    
    alert('✅ 비밀번호가 초기화되었습니다.\n\n새 비밀번호: 0000\n\n담당자에게 알려주세요.');
    
    // 담당자 목록 새로고침
    await fetchManagers();
    
    // 모달이 열려있다면 닫기
    const modal = document.getElementById('modal');
    if (modal) {
      modal.style.display = 'none';
    }
    
  } catch (error) {
    console.error('비밀번호 초기화 실패:', error);
    let errorMessage = '비밀번호 초기화에 실패했습니다.';
    
    if (error.code === 'functions/permission-denied') {
      errorMessage = '권한이 없습니다. 관리자로 로그인해주세요.';
    } else if (error.code === 'functions/unauthenticated') {
      errorMessage = '인증이 필요합니다. 다시 로그인해주세요.';
    }
    
    alert(`❌ ${errorMessage}\n\n${error.message || error}`);
  }
}

// 엑셀 파일 업로드 관련 전역 변수
let excelData = null;

// 엑셀 파일 처리 함수
window.handleExcelFile = function(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  // 파일명 표시
  document.getElementById('selectedFileName').textContent = file.name;
  document.getElementById('uploadExcelBtn').style.display = 'inline-flex';
  
  // 파일 읽기
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      
      // 첫 번째 시트 가져오기
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // JSON으로 변환
      excelData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      console.log('엑셀 데이터 로드 완료:', excelData.length, '행');
      
    } catch (error) {
      console.error('엑셀 파일 처리 오류:', error);
      alert('엑셀 파일을 읽는 중 오류가 발생했습니다.');
    }
  };
  
  reader.readAsArrayBuffer(file);
};

// 엑셀 데이터 업로드 함수
window.uploadExcelData = async function() {
  if (!excelData || excelData.length === 0) {
    alert('엑셀 파일을 먼저 선택해주세요.');
    return;
  }
  
  if (!confirm('엑셀 파일의 데이터를 업로드하시겠습니까?\n\n※ 기존 데이터가 있는 경우 덮어쓰기됩니다.')) {
    return;
  }
  
  // 진행률 표시
  const progressContainer = document.getElementById('uploadProgress');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const resultContainer = document.getElementById('uploadResult');
  
  progressContainer.style.display = 'block';
  resultContainer.style.display = 'none';
  
  try {
    // 헤더 행 찾기 (첫 번째 행)
    const headers = excelData[0];
    console.log('=== 엑셀 파일 분석 시작 ===');
    console.log('엑셀 전체 데이터 행 수:', excelData.length);
    console.log('첫 번째 행 (헤더):', headers);
    console.log('두 번째 행 (첫 데이터):', excelData[1]);
    
    // 헤더에서 필요한 컬럼 인덱스 찾기
    const columnMapping = findColumnMappings(headers);
    console.log('=== 최종 컬럼 매핑 결과 ===');
    console.log('컬럼 매핑:', columnMapping);
    
    // 매핑된 보험사 개수 확인
    const mappedCompanies = Object.keys(columnMapping.insuranceAccounts);
    console.log(`매핑된 보험사 개수: ${mappedCompanies.length}개`);
    console.log('매핑된 보험사들:', mappedCompanies);
    
    if (!columnMapping.managerName) {
      alert('담당자명(사원명) 컬럼을 찾을 수 없습니다.');
      return;
    }
    
    // 데이터 행들 처리
    const dataRows = excelData.slice(1); // 헤더 제외
    let processedCount = 0;
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      
      // 진행률 업데이트
      const progress = ((i + 1) / dataRows.length) * 100;
      progressBar.style.width = progress + '%';
      progressText.textContent = `처리 중... ${i + 1}/${dataRows.length} (${Math.round(progress)}%)`;
      
      try {
        // 빈 행 건너뛰기
        if (!row || row.length === 0 || !row[columnMapping.managerName]) {
          continue;
        }
        
        const managerName = row[columnMapping.managerName]?.toString().trim();
        if (!managerName) continue;
        
        // 담당자 찾기 (이름으로 매칭)
        const manager = managers.find(m => m.name === managerName);
        if (!manager) {
          errors.push(`행 ${i + 2}: 담당자명 '${managerName}' 을(를) 찾을 수 없습니다.`);
          errorCount++;
          continue;
        }
        
        // 업데이트 데이터 준비
        const updateData = {
          managerId: manager.id,
          code: manager.code,
          createdAt: manager.createdAt ? {
            seconds: manager.createdAt.seconds,
            nanoseconds: manager.createdAt.nanoseconds
          } : null
        };
        
        // 가이아 아이디 처리 (사원번호를 가이아 아이디로 사용)
        if (columnMapping.employeeNumber !== null && columnMapping.employeeNumber !== undefined && row[columnMapping.employeeNumber]) {
          updateData.gaiaId = row[columnMapping.employeeNumber].toString().trim();
          console.log(`${managerName} 가이아 아이디 설정: ${updateData.gaiaId} (컬럼 ${columnMapping.employeeNumber})`);
        } else {
          console.log(`${managerName} 가이아 아이디 설정 실패 - employeeNumber: ${columnMapping.employeeNumber}, 값: ${row[columnMapping.employeeNumber] || '없음'}`);
        }
        
        // 보험사 계정 정보 처리
        const insuranceAccounts = {};
        let hasInsuranceData = false;
        
        console.log(`${managerName} 담당자 보험사 정보 처리 시작`);
        
        // 생명보험사 처리
        lifeInsuranceCompanies.forEach(company => {
          const employeeIdCol = columnMapping.insuranceAccounts[company.key]?.employeeId;
          const passwordCol = columnMapping.insuranceAccounts[company.key]?.password;
          
          if (employeeIdCol !== undefined || passwordCol !== undefined) {
            const employeeId = employeeIdCol !== undefined ? (row[employeeIdCol]?.toString().trim() || '') : '';
            const password = passwordCol !== undefined ? (row[passwordCol]?.toString().trim() || '') : '';
            
            console.log(`${company.name}: 사원번호=${employeeId}, 비밀번호=${password ? '***' : '없음'}`);
            
            if (employeeId || password) {
              insuranceAccounts[company.key] = { employeeId, password };
              hasInsuranceData = true;
            }
          }
        });
        
        // 손해보험사 처리
        nonLifeInsuranceCompanies.forEach(company => {
          const employeeIdCol = columnMapping.insuranceAccounts[company.key]?.employeeId;
          const passwordCol = columnMapping.insuranceAccounts[company.key]?.password;
          
          if (employeeIdCol !== undefined || passwordCol !== undefined) {
            const employeeId = employeeIdCol !== undefined ? (row[employeeIdCol]?.toString().trim() || '') : '';
            const password = passwordCol !== undefined ? (row[passwordCol]?.toString().trim() || '') : '';
            
            console.log(`${company.name}: 사원번호=${employeeId}, 비밀번호=${password ? '***' : '없음'}`);
            
            if (employeeId || password) {
              insuranceAccounts[company.key] = { employeeId, password };
              hasInsuranceData = true;
            }
          }
        });
        
        if (hasInsuranceData) {
          updateData.insuranceAccounts = insuranceAccounts;
          console.log(`${managerName}: 보험사 데이터 추가됨`, insuranceAccounts);
        } else {
          console.log(`${managerName}: 보험사 데이터 없음`);
        }
        
        console.log(`${managerName} 업데이트 데이터:`, updateData);
        
        // Firebase Functions를 통해 업데이트
        const updateManagerFunction = httpsCallable(functions, 'updateManagerInfo');
        const result = await updateManagerFunction(updateData);
        console.log(`${managerName} 업데이트 결과:`, result);
        
        successCount++;
        
      } catch (error) {
        console.error(`행 ${i + 2} 처리 오류:`, error);
        errors.push(`행 ${i + 2}: ${error.message || error}`);
        errorCount++;
      }
      
      processedCount++;
      
      // UI 업데이트를 위한 짧은 대기
      if (i % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    
    // 완료 메시지
    progressBar.style.width = '100%';
    progressText.textContent = '업로드 완료!';
    
    // 결과 표시
    let resultHtml = `
      <div style="padding: 15px; background: #f8f9fa; border-radius: 6px; border-left: 4px solid #28a745;">
        <h6 style="margin: 0 0 10px 0; color: #155724;">
          <i class="fas fa-check-circle"></i> 업로드 완료
        </h6>
        <div style="color: #155724; font-size: 14px;">
          <div>• 처리된 행: ${processedCount}개</div>
          <div>• 성공: ${successCount}개</div>
          <div>• 오류: ${errorCount}개</div>
        </div>
      </div>
    `;
    
    if (errors.length > 0) {
      resultHtml += `
        <div style="margin-top: 15px; padding: 15px; background: #fff3cd; border-radius: 6px; border-left: 4px solid #ffc107;">
          <h6 style="margin: 0 0 10px 0; color: #856404;">
            <i class="fas fa-exclamation-triangle"></i> 오류 내역
          </h6>
          <div style="max-height: 150px; overflow-y: auto; font-size: 12px; color: #856404;">
            ${errors.slice(0, 10).map(error => `<div>• ${error}</div>`).join('')}
            ${errors.length > 10 ? `<div>... 외 ${errors.length - 10}개</div>` : ''}
          </div>
        </div>
      `;
    }
    
    resultContainer.innerHTML = resultHtml;
    resultContainer.style.display = 'block';
    
    // 담당자 목록 새로고침
    if (successCount > 0) {
      await fetchManagers();
    }
    
  } catch (error) {
    console.error('엑셀 업로드 오류:', error);
    progressText.textContent = '오류 발생';
    resultContainer.innerHTML = `
      <div style="padding: 15px; background: #f8d7da; border-radius: 6px; border-left: 4px solid #dc3545;">
        <h6 style="margin: 0 0 10px 0; color: #721c24;">
          <i class="fas fa-times-circle"></i> 업로드 실패
        </h6>
        <div style="color: #721c24; font-size: 14px;">
          ${error.message || error}
        </div>
      </div>
    `;
    resultContainer.style.display = 'block';
  }
};

// 엑셀 헤더에서 컬럼 매핑 찾기
function findColumnMappings(headers) {
  console.log('엑셀 헤더들:', headers);
  console.log('총 헤더 개수:', headers.length);
  
  // 각 헤더를 자세히 분석
  headers.forEach((header, index) => {
    if (header) {
      console.log(`헤더[${index}]: "${header}" (타입: ${typeof header})`);
    }
  });
  
  const mapping = {
    managerName: null,
    employeeNumber: null,
    insuranceAccounts: {}
  };
  
  headers.forEach((header, index) => {
    if (!header) return;
    
    const headerStr = header.toString().toLowerCase().trim();
    console.log(`헤더 ${index}: "${headerStr}"`);
    
    // 담당자명(사원명) 찾기
    if (headerStr.includes('사원명') || headerStr.includes('담당자명') || headerStr.includes('이름') || headerStr === '담당자') {
      mapping.managerName = index;
      console.log(`담당자명 컬럼 찾음: ${index}`);
    }
    
    // 사원번호 찾기 (가이아 아이디로 사용) - 우선순위: 첫 번째 컬럼
    if (index === 0 && headerStr === '사원번호') {
      mapping.employeeNumber = index;
      console.log(`첫 번째 컬럼을 사원번호로 설정: ${index}`);
    } else if (headerStr.includes('사원번호') || headerStr.includes('직원번호') || headerStr === '번호') {
      mapping.employeeNumber = index;
      console.log(`사원번호 컬럼 찾음: ${index}`);
    }
    
    // 보험사 계정 정보 찾기 - Excel 헤더와 정확히 일치하는 방식
    [...lifeInsuranceCompanies, ...nonLifeInsuranceCompanies].forEach(company => {
      // Excel 헤더와 정확히 일치하는지 확인 (대소문자 구분 없이)
      if (headerStr === company.name.toLowerCase()) {
        if (!mapping.insuranceAccounts[company.key]) {
          mapping.insuranceAccounts[company.key] = {};
        }
        
        console.log(`${company.name} 컬럼 찾음: ${headerStr} (인덱스: ${index})`);
        
        // Excel에서는 각 보험사별로 하나의 컬럼만 있고, 그 안에 사원번호가 들어있음
        mapping.insuranceAccounts[company.key].employeeId = index;
        console.log(`${company.name} 사원번호 컬럼: ${index}`);
      }
    });
  });
  
  console.log('최종 컬럼 매핑:', mapping);
  return mapping;
}

// =============================================
// 자격시험 일정 관련 함수들
// =============================================

// 자격시험 일정 새로고침 함수
window.refreshExamSchedule = async function() {
  const refreshBtn = document.getElementById('refreshExamScheduleBtn');
  const lastUpdateSpan = document.getElementById('lastUpdateTime');
  
  try {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 새로고침 중...';
    
    // 생명보험협회 자격시험 일정 크롤링
    const crawlLifeInsuranceExamSchedule = httpsCallable(functions, 'crawlLifeInsuranceExamSchedule');
    const result = await crawlLifeInsuranceExamSchedule();
    
    console.log('자격시험 일정 새로고침 결과:', result);
    
    // 성공 메시지
    alert(`✅ ${result.data.message}`);
    
    // 일정 다시 로드
    await loadExamSchedules();
    
    // 마지막 업데이트 시간 표시
    const now = new Date();
    lastUpdateSpan.textContent = `마지막 업데이트: ${now.toLocaleString('ko-KR')}`;
    
  } catch (error) {
    console.error('자격시험 일정 새로고침 실패:', error);
    alert(`❌ 자격시험 일정 새로고침에 실패했습니다.\n\n${error.message}`);
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> 일정 새로고침';
  }
};

// ========== 토스트 메시지 표시 기능 ==========
function showToast(message, type = 'info') {
  // 기존 토스트가 있으면 제거
  const existingToast = document.querySelector('.admin-toast');
  if (existingToast) {
    existingToast.remove();
  }

  // 토스트 요소 생성
  const toast = document.createElement('div');
  toast.className = 'admin-toast';
  
  // 타입별 색상 설정
  let backgroundColor;
  switch (type) {
    case 'success':
      backgroundColor = '#27ae60';
      break;
    case 'error':
      backgroundColor = '#e74c3c';
      break;
    case 'warning':
      backgroundColor = '#f39c12';
      break;
    default:
      backgroundColor = '#3498db';
  }
  
  // 스타일 적용
  Object.assign(toast.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    background: backgroundColor,
    color: 'white',
    padding: '16px 24px',
    borderRadius: '8px',
    fontWeight: '600',
    fontSize: '14px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    zIndex: '10000',
    opacity: '0',
    transform: 'translateX(100%)',
    transition: 'all 0.3s ease'
  });
  
  toast.textContent = message;
  document.body.appendChild(toast);
  
  // 애니메이션으로 나타내기
  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(0)';
  }, 100);
  
  // 3초 후 사라지기
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 3000);
}

// ========== 위촉자 신청 링크 복사 기능 ==========
// 위촉자 신청 링크 복사 함수 (어드민용 - 담당자 코드 없이)
window.copyApplicantLink = function(url, examDate, buttonElement) {
  // 버튼 요소가 전달되지 않은 경우 이벤트를 통해 찾기
  if (!buttonElement) {
    buttonElement = event.target;
  }
  
  // 버튼 상태 변경 함수
  function updateButtonState(button, text, color, icon) {
    if (button) {
      button.innerHTML = `<i class="${icon}"></i> ${text}`;
      if (color) {
        button.style.background = color;
      }
    }
  }
  
  // 원본 버튼 내용 저장
  const originalHTML = buttonElement.innerHTML;
  const originalBackground = buttonElement.style.background;
  
  // 복사 중 표시
  updateButtonState(buttonElement, '복사중...', 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)', 'fas fa-spinner fa-spin');
  
  // 클립보드에 URL 복사
  navigator.clipboard.writeText(url).then(() => {
    // 성공 표시
    updateButtonState(buttonElement, '복사됨!', 'linear-gradient(135deg, #27ae60 0%, #2ecc71 100%)', 'fas fa-check');
    
    // 토스트 메시지 표시
    showToast(`📋 신청 링크가 복사되었습니다!`, 'success');
    
    // 2초 후 원래 상태로 복원
    setTimeout(() => {
      buttonElement.innerHTML = originalHTML;
      buttonElement.style.background = originalBackground;
    }, 2000);
  }).catch(err => {
    console.error('링크 복사 실패:', err);
    // 클립보드 API가 지원되지 않는 경우 fallback
    const textArea = document.createElement('textarea');
    textArea.value = url;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      // 성공 표시
      updateButtonState(buttonElement, '복사됨!', 'linear-gradient(135deg, #27ae60 0%, #2ecc71 100%)', 'fas fa-check');
      showToast(`📋 신청 링크가 복사되었습니다!`, 'success');
      
      // 2초 후 원래 상태로 복원
      setTimeout(() => {
        buttonElement.innerHTML = originalHTML;
        buttonElement.style.background = originalBackground;
      }, 2000);
    } catch (err) {
      // 실패 표시
      updateButtonState(buttonElement, '실패', 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)', 'fas fa-times');
      showToast(`❌ 링크 복사에 실패했습니다`, 'error');
      
      // 3초 후 원래 상태로 복원
      setTimeout(() => {
        buttonElement.innerHTML = originalHTML;
        buttonElement.style.background = originalBackground;
      }, 3000);
    }
    document.body.removeChild(textArea);
  });
};

// 자격시험 일정 초기화 함수
function initializeExamSchedule() {
  // 컴포넌트가 이미 초기화되었으면 파괴
  if (examScheduleUI) {
    examScheduleUI.destroy();
  }
  
  // 새로운 컴포넌트 생성 및 초기화 (어드민용)
  examScheduleUI = ExamScheduleUI.createWithCrawlButton('lifeInsuranceSchedule', {
    defaultRegion: '서울',
    showCrawlButton: true,
    isAdminMode: true  // 어드민 모드 플래그 추가
  });
  
  examScheduleUI.initialize();
}

// ========== 자격시험 일정 관련 (새로운 컴포넌트 사용) ==========
let examScheduleUI;

// ========== 엑셀 템플릿 다운로드 기능 ==========

// 엑셀 양식 다운로드 함수
window.downloadExcelTemplate = function() {
  try {
    // 다운로드 버튼 비활성화 및 로딩 상태 표시
    const downloadBtn = event.target;
    const originalHTML = downloadBtn.innerHTML;
    downloadBtn.disabled = true;
    downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 생성 중...';
    
    // 비동기 처리를 위한 setTimeout 사용
    setTimeout(() => {
      try {
        // 워크북 생성
        const wb = XLSX.utils.book_new();
        
        // 헤더 생성 (현재 시스템이 인식하는 컬럼들)
        const headers = [
          '사원번호', // 가이아 아이디로 사용
          '담당자명'  // 필수 매칭 컬럼
        ];
        
        // 보험사 컬럼들 추가 (생명보험사 + 손해보험사)
        const allInsuranceCompanies = [...lifeInsuranceCompanies, ...nonLifeInsuranceCompanies];
        allInsuranceCompanies.forEach(company => {
          headers.push(company.name);
        });
        
        // 샘플 데이터 생성
        const sampleData = [
          headers, // 첫 번째 행: 헤더
          [ // 두 번째 행: 예시 데이터
            '12345',        // 사원번호
            '홍길동',       // 담당자명
            ...Array(allInsuranceCompanies.length).fill('') // 보험사별 사원번호 (빈 값)
          ],
          [ // 세 번째 행: 다른 예시
            '67890',        // 사원번호  
            '김철수',       // 담당자명
            'EMP001',       // ABL생명 사원번호 (예시)
            '',             // 흥국생명 (빈 값)
            'NH123',        // NH농협생명 사원번호 (예시)
            ...Array(allInsuranceCompanies.length - 3).fill('') // 나머지는 빈 값
          ]
        ];
        
        // 워크시트 생성
        const ws = XLSX.utils.aoa_to_sheet(sampleData);
        
        // 컬럼 너비 설정
        const colWidths = [
          { wch: 12 }, // 사원번호
          { wch: 15 }, // 담당자명
          ...Array(allInsuranceCompanies.length).fill({ wch: 15 }) // 보험사들
        ];
        ws['!cols'] = colWidths;
        
        // 셀 스타일 설정 (헤더 행)
        const headerRange = XLSX.utils.decode_range(ws['!ref']);
        for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
          const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
          if (ws[cellAddress]) {
            ws[cellAddress].s = {
              font: { bold: true, color: { rgb: 'FFFFFF' } },
              fill: { fgColor: { rgb: '366092' } },
              alignment: { horizontal: 'center' }
            };
          }
        }
        
        // 워크북에 시트 추가
        XLSX.utils.book_append_sheet(wb, ws, '담당자정보템플릿');
        
        // 파일명 생성 (현재 날짜 포함)
        const today = new Date();
        const dateStr = today.getFullYear() + 
                       String(today.getMonth() + 1).padStart(2, '0') + 
                       String(today.getDate()).padStart(2, '0');
        const fileName = `담당자정보_업로드템플릿_${dateStr}.xlsx`;
        
        // 파일 다운로드
        XLSX.writeFile(wb, fileName);
        
        // 버튼 상태 복원
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = originalHTML;
        
      } catch (error) {
        console.error('엑셀 템플릿 생성 오류:', error);
        // 버튼 상태 복원
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = originalHTML;
        showAlert('엑셀 템플릿 생성 중 오류가 발생했습니다.');
      }
    }, 100);
    
  } catch (error) {
    console.error('엑셀 템플릿 다운로드 오류:', error);
    showAlert('엑셀 템플릿 다운로드 중 오류가 발생했습니다.');
  }
};



// ========== Admin 전용 ApplicantViewer 클래스 ==========
class AdminApplicantViewer {
  constructor(containerId) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    this.applicants = [];
    this.filteredApplicants = [];
    this.currentFilter = '';
    this.modal = null;
    this.examSchedules = []; // 자격시험 일정 데이터 저장
  }

  async initialize() {
    if (!this.container) {
      throw new Error('컨테이너를 찾을 수 없습니다.');
    }

    // HTML 구조 생성
    this.render();
    
    // 이벤트 리스너 설정
    this.setupEventListeners();
    
    // 자격시험 일정 먼저 로드
    await this.loadExamSchedules();
    
    // 데이터 로드
    await this.loadApplicants();
    
    // 모달 생성
    this.createModal();
  }

  /**
   * 자격시험 일정 데이터 로드
   */
  async loadExamSchedules() {
    try {
      const { getLifeInsuranceExamSchedules } = await import('../common/js/services/exam-service.js');
      const result = await getLifeInsuranceExamSchedules();
      
      if (result.success && result.schedules) {
        this.examSchedules = result.schedules;
      }
    } catch (error) {
      console.warn('자격시험 일정 로드 실패:', error);
      this.examSchedules = [];
    }
  }

  render() {
    this.container.innerHTML = `
      <div style="text-align: center; margin-bottom: 24px;">
        <h3 style="margin: 0 0 8px 0; color: #2c3e50; font-size: 24px; font-weight: 600;">
          위촉자 조회
        </h3>
        <p style="margin: 0; color: #666; font-size: 14px;">
          전체 담당자의 위촉자 정보를 조회하고 관리합니다.
        </p>
      </div>
      
      <div class="admin-search-area">
        <div class="admin-search-input-group">
          <input type="text" id="admin-applicant-search" placeholder="성명, 전화번호, 시험일, 담당자로 검색">
          <button type="button" id="admin-search-reset" class="admin-search-reset-btn">
            <i class="fas fa-redo-alt"></i>
          </button>
        </div>
        <button type="button" id="admin-excel-download" class="admin-excel-download-btn">
          <i class="fas fa-file-excel"></i> 엑셀 다운로드
        </button>
      </div>
      
      <div id="admin-applicant-list" class="admin-card-list"></div>
    `;
  }

  setupEventListeners() {
    // 검색 이벤트
    const searchInput = document.getElementById('admin-applicant-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.currentFilter = e.target.value.trim();
        this.filterApplicants();
      });
    }

    // 리셋 버튼
    const resetBtn = document.getElementById('admin-search-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        searchInput.value = '';
        this.currentFilter = '';
        this.filterApplicants();
      });
    }

    // 엑셀 다운로드
    const excelBtn = document.getElementById('admin-excel-download');
    if (excelBtn) {
      excelBtn.addEventListener('click', () => {
        this.downloadExcel();
      });
    }
  }

  async loadApplicants() {
    try {
      const applicantsRef = collection(db, 'applicants');
      const querySnapshot = await getDocs(applicantsRef);
      
      this.applicants = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        this.applicants.push({
          id: doc.id,
          ...data
        });
      });

      this.filteredApplicants = [...this.applicants];
      this.renderStats();
      await this.renderCards();
      
    } catch (error) {
      console.error('위촉자 데이터 로드 실패:', error);
      this.container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #e74c3c;">
          <i class="fas fa-exclamation-triangle" style="font-size: 24px;"></i>
          <p style="margin-top: 16px;">위촉자 정보를 불러올 수 없습니다.</p>
          <button onclick="initializeApplicantViewer()" style="margin-top: 16px; padding: 8px 16px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;">
            다시 시도
          </button>
        </div>
      `;
    }
  }

  renderStats() {
    const statsContainer = document.getElementById('admin-stats');
    if (!statsContainer) return;

    const totalApplicants = this.applicants.length;
    const recentApplicants = this.applicants.filter(a => {
      const createdAt = a.created_at?.toDate ? a.created_at.toDate() : new Date(a.created_at);
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return createdAt >= weekAgo;
    }).length;

    statsContainer.innerHTML = `
      <div class="admin-stat-card">
        <div class="admin-stat-icon">
          <i class="fas fa-users"></i>
        </div>
        <div class="admin-stat-content">
          <div class="admin-stat-number">${totalApplicants}</div>
          <div class="admin-stat-label">전체 위촉자</div>
        </div>
      </div>
      
      <div class="admin-stat-card">
        <div class="admin-stat-icon">
          <i class="fas fa-user-plus"></i>
        </div>
        <div class="admin-stat-content">
          <div class="admin-stat-number">${recentApplicants}</div>
          <div class="admin-stat-label">최근 7일</div>
        </div>
      </div>
      
      <div class="admin-stat-card">
        <div class="admin-stat-icon">
          <i class="fas fa-filter"></i>
        </div>
        <div class="admin-stat-content">
          <div class="admin-stat-number">${this.filteredApplicants.length}</div>
          <div class="admin-stat-label">검색 결과</div>
        </div>
      </div>
    `;
  }

  async filterApplicants() {
    if (!this.currentFilter) {
      this.filteredApplicants = [...this.applicants];
    } else {
      const filter = this.currentFilter.toLowerCase();
      this.filteredApplicants = this.applicants.filter(applicant => {
        return (
          (applicant.name && applicant.name.toLowerCase().includes(filter)) ||
          (applicant.phone && applicant.phone.includes(filter)) ||
          (applicant.managerCode && applicant.managerCode.toLowerCase().includes(filter))
        );
      });
    }
    
    this.renderStats();
    await this.renderCards();
  }

  async renderCards() {
    const listContainer = document.getElementById('admin-applicant-list');
    if (!listContainer) return;

    if (this.filteredApplicants.length === 0) {
      listContainer.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #666;">
          <i class="fas fa-search" style="font-size: 48px; margin-bottom: 20px; opacity: 0.5;"></i>
          <p>검색 결과가 없습니다.</p>
        </div>
      `;
      return;
    }

    // 담당자 정보를 미리 로드 (성능 최적화)
    const managerCodes = [...new Set(this.filteredApplicants.map(a => a.managerCode).filter(Boolean))];
    const managerInfoMap = new Map();
    
    for (const code of managerCodes) {
      const managerInfo = await this.getManagerInfo(code);
      if (managerInfo) {
        managerInfoMap.set(code, managerInfo);
      }
    }

    listContainer.innerHTML = this.filteredApplicants.map(applicant => {
      const createdAt = applicant.created_at?.toDate ? applicant.created_at.toDate() : new Date(applicant.created_at);
      const dateStr = createdAt.toLocaleDateString('ko-KR');
      
      // 담당자 정보
      const managerInfo = managerInfoMap.get(applicant.managerCode);
      const managerDisplay = managerInfo 
        ? `${managerInfo.name}(${managerInfo.gaiaId || applicant.managerCode})`
        : applicant.managerCode || '-';

      // 시험 지역 정보
      let regionDisplay = '-';
      if (applicant.examId) {
        const examData = this.parseExamIdToData(applicant.examId);
        if (examData?.region) {
          regionDisplay = examData.region;
        }
      }

      // 시험 일정 정보
      let examDateDisplay = '-';
      if (applicant.examId) {
        const examData = this.parseExamIdToData(applicant.examId);
        if (examData?.examDate) {
          const examRound = this.getExamRound(examData.examDate, examData.region);
          examDateDisplay = examData.examDate + (examRound ? ` (${examRound})` : '');
        }
      }
      
      return `
        <div class="admin-client-card" onclick="window.adminApplicantViewer.viewDetail('${applicant.id}')">
          <div class="card-header">
            <h4 class="name">${applicant.name || '이름 없음'}</h4>
            <span class="date">${dateStr}</span>
          </div>
          <div class="card-body">
            <div class="info-item">
              <span class="label">전화번호:</span>
              <span class="value">${applicant.phone || '-'}</span>
            </div>
            <div class="info-item">
              <span class="label">시험일:</span>
              <span class="value">${examDateDisplay}</span>
            </div>
            <div class="info-item">
              <span class="label">시험지역:</span>
              <span class="value">${regionDisplay}</span>
            </div>
            <div class="info-item">
              <span class="label">담당자:</span>
              ${!applicant.managerCode ? `
                <button class="assign-manager-btn" onclick="event.stopPropagation(); window.adminApplicantViewer.showManagerAssignModal('${applicant.id}')" style="
                  background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%);
                  color: white;
                  border: none;
                  padding: 6px 10px;
                  border-radius: 4px;
                  font-size: 11px;
                  font-weight: 600;
                  cursor: pointer;
                  transition: transform 0.2s ease;
                  margin-left: auto;
                " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                  <i class="fas fa-user-plus"></i> 지정
                </button>
              ` : `
                <span class="value">${managerDisplay}</span>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  createModal() {
    // 기존 모달 제거
    const existingModal = document.getElementById('admin-applicant-modal');
    if (existingModal) {
      existingModal.remove();
    }

    // 새 모달 생성
    const modal = document.createElement('div');
    modal.id = 'admin-applicant-modal';
    modal.className = 'admin-applicant-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3 id="admin-modal-title">위촉자 상세 정보</h3>
          <span class="close" onclick="window.adminApplicantViewer.closeModal()">&times;</span>
        </div>
        <div class="modal-body" id="admin-modal-body">
          <!-- 상세 정보가 여기에 표시됩니다 -->
        </div>
        <div class="modal-footer">
          <button class="admin-secondary-btn" onclick="window.adminApplicantViewer.closeModal()">닫기</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.modal = modal;

    // 모달 외부 클릭시 닫기
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeModal();
      }
    });
  }

  async viewDetail(applicantId) {
    const applicant = this.applicants.find(a => a.id === applicantId);
    if (!applicant) {
      showAlert('위촉자 정보를 찾을 수 없습니다.');
      return;
    }

    const modalBody = document.getElementById('admin-modal-body');
    const modalTitle = document.getElementById('admin-modal-title');
    
    if (!modalBody || !modalTitle) return;

    modalTitle.textContent = `${applicant.name || '위촉자'}님 상세 정보`;

    try {
      // 주민등록번호 복호화
      const decryptedSSN = applicant.ssn ? await decryptSSN(applicant.ssn) : '-';
      
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

      // 시험 정보 파싱
      let examInfo = { examDate: '', region: '', applicationPeriod: '' };
      if (applicant.examId) {
        const examData = this.parseExamIdToData(applicant.examId);
        if (examData) {
          examInfo = examData;
        }
      }

      modalBody.innerHTML = `
        <!-- 기본 정보 -->
        <div class="detail-section">
          <h5><i class="fas fa-user"></i> 기본 정보</h5>
          <div class="detail-grid">
            <div class="detail-item">
              <label>이름</label>
              <span>${applicant.name || '-'}</span>
            </div>
            <div class="detail-item">
              <label>주민등록번호</label>
              <span>${decryptedSSN}</span>
            </div>
            <div class="detail-item full-width">
              <label>등록일</label>
              <span>${dateStr}</span>
            </div>
          </div>
        </div>

        <!-- 연락처 정보 -->
        <div class="detail-section">
          <h5><i class="fas fa-phone"></i> 연락처 정보</h5>
          <div class="detail-grid">
            <div class="detail-item">
              <label>통신사</label>
              <span>${applicant.phoneCarrier || '-'}</span>
            </div>
            <div class="detail-item">
              <label>핸드폰번호</label>
              <span>${applicant.phone || '-'}</span>
            </div>
            <div class="detail-item full-width">
              <label>이메일</label>
              <span>${applicant.email || '-'}</span>
            </div>
          </div>
        </div>

        <!-- 주소 정보 -->
        <div class="detail-section">
          <h5><i class="fas fa-map-marker-alt"></i> 주소 정보</h5>
          <div class="detail-grid">
            <div class="detail-item">
              <label>우편번호</label>
              <span>${applicant.postcode || '-'}</span>
            </div>
            <div class="detail-item full-width">
              <label>주소</label>
              <span>${applicant.address || '-'}</span>
            </div>
            <div class="detail-item full-width">
              <label>상세주소</label>
              <span>${applicant.addressDetail || '-'}</span>
            </div>
          </div>
        </div>

        <!-- 계좌 정보 -->
        <div class="detail-section">
          <h5><i class="fas fa-university"></i> 계좌 정보</h5>
          <div class="detail-grid">
            <div class="detail-item">
              <label>은행</label>
              <span>${applicant.bank || '-'}</span>
            </div>
            <div class="detail-item">
              <label>계좌번호</label>
              <span>${applicant.accountNumber || '-'}</span>
            </div>
            <div class="detail-item">
              <label>예금주</label>
              <span>${applicant.accountHolder || '-'}</span>
            </div>
          </div>
        </div>

        <!-- 학력 및 경력 -->
        <div class="detail-section">
          <h5><i class="fas fa-graduation-cap"></i> 학력 및 경력</h5>
          <div class="detail-grid">
            <div class="detail-item">
              <label>최종 학력</label>
              <span>${applicant.education || '-'}</span>
            </div>
            ${applicant.schoolName ? `
            <div class="detail-item">
              <label>학교명</label>
              <span>${applicant.schoolName}</span>
            </div>
            ` : ''}
            ${applicant.major ? `
            <div class="detail-item">
              <label>전공</label>
              <span>${applicant.major}</span>
            </div>
            ` : ''}
            <div class="detail-item">
              <label>경력</label>
              <span>${applicant.experience || '-'}</span>
            </div>
            ${applicant.experience === '경력자' ? `
            <div class="detail-item">
              <label>경력 연차</label>
              <span>${applicant.experienceYears || '-'}년</span>
            </div>
            <div class="detail-item">
              <label>이전 회사</label>
              <span>${applicant.prevCompany || '-'}</span>
            </div>
            ` : ''}
          </div>
        </div>

        ${applicant.examId ? `
        <!-- 시험 일정 정보 -->
        <div class="detail-section">
          <h5><i class="fas fa-calendar"></i> 시험 일정 정보</h5>
          <div class="detail-grid">
            <div class="detail-item">
              <label>시험명</label>
              <span>생명보험자격시험</span>
            </div>
            <div class="detail-item">
              <label>시험일</label>
              <span>${examInfo.examDate || '미정'}${this.getExamRound(examInfo.examDate, examInfo.region) ? ` (${this.getExamRound(examInfo.examDate, examInfo.region)})` : ''}</span>
            </div>
            <div class="detail-item">
              <label>지역</label>
              <span>${examInfo.region || '미정'}</span>
            </div>
            <div class="detail-item">
              <label>접수 마감일</label>
              <span>${examInfo.applicationPeriod || '미정'}</span>
            </div>
          </div>
        </div>
        ` : ''}

        <!-- 도입자 정보 -->
        <div class="detail-section">
          <h5>
            <i class="fas fa-user-tie"></i> 도입자 정보
            <button onclick="window.adminApplicantViewer.showManagerEditModal('${applicant.id}')" style="
              background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
              color: white;
              border: none;
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 11px;
              font-weight: 600;
              cursor: pointer;
              margin-left: 8px;
              transition: transform 0.2s ease;
            " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
              <i class="fas fa-edit"></i> 수정
            </button>
          </h5>
          <div class="detail-grid">
            <div class="detail-item">
              <label>도입자명</label>
              <span>${managerInfo?.name || '-'}</span>
            </div>
            <div class="detail-item">
              <label>도입자 코드</label>
              <span>${applicant.managerCode || '-'} ${managerInfo?.gaiaId ? `(${managerInfo.gaiaId})` : ''}</span>
            </div>
            <div class="detail-item">
              <label>팀명</label>
              <span>${managerInfo?.team || '-'}</span>
            </div>
            <div class="detail-item">
              <label>연락처</label>
              <span>${managerInfo?.phone || '-'}</span>
            </div>
          </div>
        </div>
      `;

      this.modal.style.display = 'block';
      
    } catch (error) {
      console.error('상세 정보 로드 실패:', error);
      showAlert('상세 정보를 불러오는데 실패했습니다.');
    }
  }

  async getManagerInfo(managerCode) {
    if (!managerCode) return null;
    
    try {
      const managersRef = collection(db, 'managers');
      const q = query(managersRef, where('code', '==', managerCode));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const doc = querySnapshot.docs[0];
        return doc.data();
      }
      return null;
    } catch (error) {
      console.error('담당자 정보 로드 실패:', error);
      return null;
    }
  }

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

  closeModal() {
    if (this.modal) {
      this.modal.style.display = 'none';
    }
  }

  async downloadExcel() {
    try {
      // 로딩 상태 표시
      const downloadBtn = document.getElementById('admin-excel-download');
      if (downloadBtn) {
        downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 다운로드 중...';
        downloadBtn.disabled = true;
      }

      // 현재 필터링된 위촉자 목록을 사용
      const applicantsToDownload = this.filteredApplicants;

      if (applicantsToDownload.length === 0) {
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
      
      for (const applicant of applicantsToDownload) {
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
          let managerInfo = { name: '', team: '', code: '' };
          if (applicant.managerCode && managers[applicant.managerCode]) {
            const manager = managers[applicant.managerCode];
            managerInfo = {
              name: manager.name || '',
              team: manager.team || '',
              code: applicant.managerCode
            };
          }

          // 신청 타입 한글화
          let applicationTypeKr = '';
          switch (applicant.applicationType) {
            case 'manager_referral':
              applicationTypeKr = '담당자 추천';
              break;
            case 'admin_referral':
              applicationTypeKr = '관리자 링크';
              break;
            case 'direct_application':
            default:
              applicationTypeKr = '직접 신청';
              break;
          }

          // 성별 변환
          // const genderMap = { 'M': '남성', 'F': '여성' };
          // const gender = genderMap[applicant.gender] || applicant.gender || '';

          // 엑셀 행 데이터
          const rowData = {
            '등록일': dateStr,
            '성명': applicant.name || '',
            '주민등록번호': decryptedSSN,
            // '성별': gender,
            '이메일': applicant.email || '',
            '통신사': applicant.phoneCarrier || '',
            '휴대폰번호': applicant.phone || '',
            '우편번호': applicant.postcode || '',
            '주소': applicant.address || '',
            '상세주소': applicant.addressDetail || '',
            '은행': applicant.bank || '',
            '계좌번호': applicant.accountNumber || '',
            '예금주': applicant.accountHolder || '',
            '최종학력': applicant.education || '',
            '학교명': applicant.schoolName || '',
            '전공': applicant.major || '',
            '보험업계경력': applicant.experience || '',
            '시험일': examInfo.examDate,
            '시험지역': examInfo.region,
            '접수마감일': examInfo.applicationPeriod,
            '담당자명': managerInfo.name,
            '담당자팀': managerInfo.team,
            '담당자코드': managerInfo.code,
            '신청타입': applicationTypeKr
          };

          excelData.push(rowData);

        } catch (error) {
          console.error('위촉자 정보 처리 중 오류:', applicant.id, error);
          // 오류가 있는 위촉자는 건너뛰고 계속 진행
        }
      }

      if (excelData.length === 0) {
        showAlert('처리할 수 있는 위촉자 정보가 없습니다.');
        return;
      }

      // 엑셀 워크북 생성
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(excelData);

      // 컬럼 너비 조정
      const colWidths = [
        { wch: 12 }, // 등록일
        { wch: 10 }, // 성명
        { wch: 15 }, // 주민등록번호
        // { wch: 6 },  // 성별
        { wch: 25 }, // 이메일
        { wch: 8 },  // 통신사
        { wch: 13 }, // 휴대폰번호
        { wch: 8 },  // 우편번호
        { wch: 30 }, // 주소
        { wch: 20 }, // 상세주소
        { wch: 10 }, // 은행
        { wch: 15 }, // 계좌번호
        { wch: 10 }, // 예금주
        { wch: 10 }, // 최종학력
        { wch: 15 }, // 학교명
        { wch: 12 }, // 전공
        { wch: 12 }, // 보험업계경력
        { wch: 12 }, // 시험일
        { wch: 8 },  // 시험지역
        { wch: 15 }, // 접수마감일
        { wch: 10 }, // 담당자명
        { wch: 8 },  // 담당자팀
        { wch: 10 }, // 담당자코드
        { wch: 12 }  // 신청타입
      ];
      worksheet['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(workbook, worksheet, '위촉자정보');

      // 파일명 생성
      const now = new Date();
      const filename = `위촉자정보_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.xlsx`;

      // 파일 다운로드
      XLSX.writeFile(workbook, filename);

      showAlert(`${excelData.length}명의 위촉자 정보가 엑셀 파일로 다운로드되었습니다.`);

    } catch (error) {
      console.error('엑셀 다운로드 실패:', error);
      showAlert('엑셀 다운로드 중 오류가 발생했습니다: ' + error.message);
    } finally {
      // 버튼 상태 복원
      const downloadBtn = document.getElementById('admin-excel-download');
      if (downloadBtn) {
        downloadBtn.innerHTML = '<i class="fas fa-file-excel"></i> 엑셀 다운로드';
        downloadBtn.disabled = false;
      }
    }
  }

  // 담당자 수정 모달 표시
  async showManagerEditModal(applicantId) {
    try {
      const applicant = this.applicants.find(a => a.id === applicantId);
      if (!applicant) {
        showAlert('위촉자 정보를 찾을 수 없습니다.');
        return;
      }

      // 모든 담당자 목록 로드
      const managersRef = collection(db, 'managers');
      const managersSnapshot = await getDocs(managersRef);
      const managers = [];
      
      managersSnapshot.forEach((doc) => {
        const manager = doc.data();
        managers.push({
          id: doc.id,
          ...manager
        });
      });

      // 팀별로 그룹화
      const teamGroups = {};
      managers.forEach(manager => {
        const team = manager.team || '미분류';
        if (!teamGroups[team]) {
          teamGroups[team] = [];
        }
        teamGroups[team].push(manager);
      });

      // 현재 담당자 정보 로드
      const currentManagerInfo = await this.getManagerInfo(applicant.managerCode);

      // 모달 HTML 생성
      const modalHtml = `
        <div class="admin-applicant-modal" id="manager-edit-modal" style="display: block;">
          <div class="modal-content" style="max-width: 600px;">
            <div class="modal-header">
              <h3>담당자 수정 - ${applicant.name}</h3>
              <span class="close" onclick="window.adminApplicantViewer.closeManagerEditModal()">&times;</span>
            </div>
            <div class="modal-body">
              <div style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #3498db;">
                <p style="margin: 0; color: #2c3e50; font-weight: 600;">위촉자: ${applicant.name}</p>
                <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">전화번호: ${applicant.phone || '-'}</p>
                ${currentManagerInfo ? `<p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">현재 담당자: ${currentManagerInfo.name} (${currentManagerInfo.gaiaId || applicant.managerCode})</p>` : ''}
              </div>
              
              <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #2c3e50;">새 담당자 선택:</label>
                <select id="manager-edit-select" style="width: 100%; padding: 12px; border: 2px solid #e1e8ed; border-radius: 8px; font-size: 16px; background: white;">
                  <option value="">담당자를 선택하세요</option>
                  ${Object.entries(teamGroups).map(([team, teamManagers]) => `
                    <optgroup label="${team}">
                      ${teamManagers.map(manager => `
                        <option value="${manager.code}" ${manager.code === applicant.managerCode ? 'selected' : ''}>${manager.name} (${manager.gaiaId || manager.code})</option>
                      `).join('')}
                    </optgroup>
                  `).join('')}
                </select>
              </div>
              
              <div style="margin-bottom: 15px; padding: 12px; background: #fff3cd; border-radius: 6px; border-left: 4px solid #ffc107;">
                <p style="margin: 0; color: #856404; font-size: 13px;">
                  <i class="fas fa-info-circle"></i> 담당자를 변경하면 해당 위촉자의 담당자 정보가 즉시 업데이트됩니다.
                </p>
              </div>
            </div>
            <div class="modal-footer" style="display: flex; gap: 10px; justify-content: flex-end;">
              <button class="admin-secondary-btn" onclick="window.adminApplicantViewer.closeManagerEditModal()">취소</button>
              <button class="edit-confirm-btn" onclick="window.adminApplicantViewer.updateManager('${applicantId}')" style="
                background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 600;
                transition: all 0.3s ease;
              ">
                <i class="fas fa-save"></i> 수정하기
              </button>
            </div>
          </div>
        </div>
      `;

      // 기존 모달 제거
      const existingModal = document.getElementById('manager-edit-modal');
      if (existingModal) {
        existingModal.remove();
      }

      // 모달 추가
      document.body.insertAdjacentHTML('beforeend', modalHtml);

    } catch (error) {
      console.error('담당자 수정 모달 로드 실패:', error);
      showAlert('담당자 목록을 불러오는 중 오류가 발생했습니다.');
    }
  }

  // 담당자 배정 모달 표시
  async showManagerAssignModal(applicantId) {
    try {
      const applicant = this.applicants.find(a => a.id === applicantId);
      if (!applicant) {
        showAlert('위촉자 정보를 찾을 수 없습니다.');
        return;
      }

      // 모든 담당자 목록 로드
      const managersRef = collection(db, 'managers');
      const managersSnapshot = await getDocs(managersRef);
      const managers = [];
      
      managersSnapshot.forEach((doc) => {
        const manager = doc.data();
        managers.push({
          id: doc.id,
          ...manager
        });
      });

      // 팀별로 그룹화
      const teamGroups = {};
      managers.forEach(manager => {
        const team = manager.team || '미분류';
        if (!teamGroups[team]) {
          teamGroups[team] = [];
        }
        teamGroups[team].push(manager);
      });

      // 모달 HTML 생성
      const modalHtml = `
        <div class="admin-applicant-modal" id="manager-assign-modal" style="display: block;">
          <div class="modal-content" style="max-width: 600px;">
            <div class="modal-header">
              <h3>담당자 지정 - ${applicant.name}</h3>
              <span class="close" onclick="window.adminApplicantViewer.closeManagerAssignModal()">&times;</span>
            </div>
            <div class="modal-body">
              <div style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #3498db;">
                <p style="margin: 0; color: #2c3e50; font-weight: 600;">위촉자: ${applicant.name}</p>
                <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">전화번호: ${applicant.phone || '-'}</p>
              </div>
              
              <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #2c3e50;">팀별 담당자 선택:</label>
                <select id="manager-select" style="width: 100%; padding: 12px; border: 2px solid #e1e8ed; border-radius: 8px; font-size: 16px; background: white;">
                  <option value="">담당자를 선택하세요</option>
                  ${Object.entries(teamGroups).map(([team, teamManagers]) => `
                    <optgroup label="${team}">
                      ${teamManagers.map(manager => `
                        <option value="${manager.code}">${manager.name} (${manager.gaiaId || manager.code})</option>
                      `).join('')}
                    </optgroup>
                  `).join('')}
                </select>
              </div>
            </div>
            <div class="modal-footer" style="display: flex; gap: 10px; justify-content: flex-end;">
              <button class="admin-secondary-btn" onclick="window.adminApplicantViewer.closeManagerAssignModal()">취소</button>
              <button class="assign-confirm-btn" onclick="window.adminApplicantViewer.assignManager('${applicantId}')" style="
                background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%);
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 600;
                transition: all 0.3s ease;
              ">
                <i class="fas fa-check"></i> 지정하기
              </button>
            </div>
          </div>
        </div>
      `;

      // 기존 모달 제거
      const existingModal = document.getElementById('manager-assign-modal');
      if (existingModal) {
        existingModal.remove();
      }

      // 모달 추가
      document.body.insertAdjacentHTML('beforeend', modalHtml);

    } catch (error) {
      console.error('담당자 배정 모달 로드 실패:', error);
      showAlert('담당자 목록을 불러오는 중 오류가 발생했습니다.');
    }
  }

  // 담당자 배정 모달 닫기
  closeManagerAssignModal() {
    const modal = document.getElementById('manager-assign-modal');
    if (modal) {
      modal.remove();
    }
  }

  // 담당자 배정 실행
  async assignManager(applicantId) {
    try {
      const managerSelect = document.getElementById('manager-select');
      const selectedManagerCode = managerSelect.value;

      if (!selectedManagerCode) {
        showAlert('담당자를 선택해주세요.');
        return;
      }

      // 로딩 상태 표시
      const confirmBtn = document.querySelector('.assign-confirm-btn');
      const originalText = confirmBtn.innerHTML;
      confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 지정 중...';
      confirmBtn.disabled = true;

      // Firestore에 담당자 정보 업데이트
      const applicantRef = doc(db, 'applicants', applicantId);
      await updateDoc(applicantRef, {
        managerCode: selectedManagerCode,
        updated_at: new Date()
      });

      // 로컬 데이터 업데이트
      const applicantIndex = this.applicants.findIndex(a => a.id === applicantId);
      if (applicantIndex !== -1) {
        this.applicants[applicantIndex].managerCode = selectedManagerCode;
        this.applicants[applicantIndex].updated_at = new Date();
      }

      // 필터링된 데이터도 업데이트
      const filteredIndex = this.filteredApplicants.findIndex(a => a.id === applicantId);
      if (filteredIndex !== -1) {
        this.filteredApplicants[filteredIndex].managerCode = selectedManagerCode;
        this.filteredApplicants[filteredIndex].updated_at = new Date();
      }

      // 화면 재렌더링
      await this.renderCards();
      this.renderStats();

      // 모달 닫기
      this.closeManagerAssignModal();

      showToast('담당자가 성공적으로 지정되었습니다!', 'success');

    } catch (error) {
      console.error('담당자 배정 실패:', error);
      showAlert('담당자 지정 중 오류가 발생했습니다: ' + error.message);
      
      // 버튼 상태 복원
      const confirmBtn = document.querySelector('.assign-confirm-btn');
      if (confirmBtn) {
        confirmBtn.innerHTML = '<i class="fas fa-check"></i> 지정하기';
        confirmBtn.disabled = false;
      }
    }
  }

  // 담당자 수정 모달 닫기
  closeManagerEditModal() {
    const modal = document.getElementById('manager-edit-modal');
    if (modal) {
      modal.remove();
    }
  }

  // 담당자 수정 실행
  async updateManager(applicantId) {
    try {
      const managerSelect = document.getElementById('manager-edit-select');
      const selectedManagerCode = managerSelect.value;

      if (!selectedManagerCode) {
        showAlert('새 담당자를 선택해주세요.');
        return;
      }

      // 현재 담당자와 동일한지 확인
      const applicant = this.applicants.find(a => a.id === applicantId);
      if (applicant && applicant.managerCode === selectedManagerCode) {
        showAlert('현재 담당자와 동일합니다.');
        return;
      }

      // 로딩 상태 표시
      const confirmBtn = document.querySelector('.edit-confirm-btn');
      const originalText = confirmBtn.innerHTML;
      confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 수정 중...';
      confirmBtn.disabled = true;

      // Firestore에 담당자 정보 업데이트
      const applicantRef = doc(db, 'applicants', applicantId);
      await updateDoc(applicantRef, {
        managerCode: selectedManagerCode,
        updated_at: new Date()
      });

      // 로컬 데이터 업데이트
      const applicantIndex = this.applicants.findIndex(a => a.id === applicantId);
      if (applicantIndex !== -1) {
        this.applicants[applicantIndex].managerCode = selectedManagerCode;
        this.applicants[applicantIndex].updated_at = new Date();
      }

      // 필터링된 데이터도 업데이트
      const filteredIndex = this.filteredApplicants.findIndex(a => a.id === applicantId);
      if (filteredIndex !== -1) {
        this.filteredApplicants[filteredIndex].managerCode = selectedManagerCode;
        this.filteredApplicants[filteredIndex].updated_at = new Date();
      }

      // 화면 재렌더링
      await this.renderCards();
      this.renderStats();

      // 상세 모달이 열려있으면 새로고침
      const detailModal = document.getElementById('admin-applicant-modal');
      if (detailModal && detailModal.style.display !== 'none') {
        // 잠시 후 상세 모달 새로고침
        setTimeout(() => {
          this.viewDetail(applicantId);
        }, 100);
      }

      // 모달 닫기
      this.closeManagerEditModal();

      showToast('담당자가 성공적으로 수정되었습니다!', 'success');

    } catch (error) {
      console.error('담당자 수정 실패:', error);
      showAlert('담당자 수정 중 오류가 발생했습니다: ' + error.message);
      
      // 버튼 상태 복원
      const confirmBtn = document.querySelector('.edit-confirm-btn');
      if (confirmBtn) {
        confirmBtn.innerHTML = '<i class="fas fa-save"></i> 수정하기';
        confirmBtn.disabled = false;
      }
    }
  }

  destroy() {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
  }
}

// 전역 변수
let adminApplicantViewer = null;

// admin 전용 위촉자 뷰어 초기화 함수를 새로 작성
function initializeApplicantViewer() {
  const container = document.getElementById('applicants-container');
  if (!container) {
    console.error('위촉자 컨테이너를 찾을 수 없습니다.');
    return;
  }

  // 기존 뷰어 정리
  if (adminApplicantViewer) {
    adminApplicantViewer.destroy();
  }

  try {
    // admin 전용 위촉자 뷰어 생성
    adminApplicantViewer = new AdminApplicantViewer('applicants-container');
    window.adminApplicantViewer = adminApplicantViewer;
    
    // 초기화
    adminApplicantViewer.initialize().catch(error => {
      console.error('위촉자 뷰어 초기화 실패:', error);
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #e74c3c;">
          <i class="fas fa-exclamation-triangle" style="font-size: 24px;"></i>
          <p style="margin-top: 16px;">위촉자 정보를 불러올 수 없습니다.</p>
          <button onclick="initializeApplicantViewer()" style="margin-top: 16px; padding: 8px 16px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;">
            다시 시도
          </button>
        </div>
      `;
    });
    
  } catch (error) {
    console.error('위촉자 뷰어 생성 실패:', error);
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #e74c3c;">
        <i class="fas fa-exclamation-triangle" style="font-size: 24px;"></i>
        <p style="margin-top: 16px;">위촉자 뷰어를 생성할 수 없습니다.</p>
        <button onclick="initializeApplicantViewer()" style="margin-top: 16px; padding: 8px 16px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;">
          다시 시도
        </button>
      </div>
    `;
  }
}

// ========== 전화번호 입력 자동 이동 기능 (HTML에서 직접 호출) ==========
window.autoMoveToNext = autoMoveToNext;
window.handlePhoneBackspace = handlePhoneBackspace;
window.initializeApplicantViewer = initializeApplicantViewer;

// ========== 전역 변수를 window에 노출 ==========
window.adminApplicantViewer = null;

