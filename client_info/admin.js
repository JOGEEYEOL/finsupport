import { initializeApp } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-auth.js";
import { getFirestore, collection, getDocs, query, where, doc, updateDoc, collection as fsCollection, addDoc, deleteDoc, onSnapshot, orderBy, Timestamp, limit, startAfter } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-firestore.js";
import { getStorage, ref, deleteObject } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.8.0/firebase-functions.js";
import { db } from "./database.js";
import { 
  lifeInsuranceCompanies, 
  nonLifeInsuranceCompanies, 
  insuranceCompanies, 
  lifeCompanies, 
  nonLifeCompanies,
  getInsuranceCompanyKey,
  getInsuranceCompanyName,
  getInsuranceCompanyType
} from "./insurance-companies.js";

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

// Firebase Auth 초기화
const auth = getAuth(app);

// Firebase Functions 초기화
const functions = getFunctions(app);

// 암호화 키는 더 이상 클라이언트에서 사용하지 않음 (서버 사이드로 이동)
// const ENCRYPT_KEY = window.currentConfig.encryptKey;
// window.ENCRYPT_KEY = ENCRYPT_KEY;

// CryptoJS는 더 이상 사용하지 않음 (서버 사이드로 이동)
// function decryptSSN(ciphertext) {
//   try {
//     if (!ciphertext) return "";
//     if (!window.CryptoJS) {
//       console.error("CryptoJS가 로드되지 않았습니다.");
//       return "복호화 실패";
//     }
//     if (!ENCRYPT_KEY) {
//       console.error("암호화 키가 정의되지 않았습니다.");
//       return "복호화 실패";
//     }
//     const bytes = window.CryptoJS.AES.decrypt(ciphertext, ENCRYPT_KEY);
//     const decrypted = bytes.toString(window.CryptoJS.enc.Utf8);
//     return decrypted || "복호화 실패";
//   } catch (e) {
//     console.error("복호화 중 에러 발생:", e);
//     return "복호화 실패";
//   }
// }

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

// 페이지네이션을 위한 새로운 변수들
let displayedClients = [];
let displayedManagers = [];
let currentClientPage = 0;
let currentManagerPage = 0;
const ITEMS_PER_PAGE = 5;

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

// Firebase Storage 초기화
const storage = getStorage();

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
  if (!window.confirm("주의: 모든 주민등록번호를 새 암호화키로 마이그레이션합니다.\n\n이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?")) {
    return;
  }
  
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
    alert(`마이그레이션 완료!\n\n` +
          `총 문서: ${resultData.total}\n` +
          `성공: ${resultData.success}\n` +
          `실패: ${resultData.fail}\n` +
          `건너뜀: ${resultData.skipped}\n\n` +
          `${resultData.message}`);
    
  } catch (error) {
    console.error('마이그레이션 에러:', error);
    alert(`마이그레이션 실패!\n\n에러: ${error.message || error}`);
  } finally {
    const migrateBtn = document.getElementById('migrateBtn');
    migrateBtn.disabled = false;
    migrateBtn.innerHTML = '<i class="fas fa-sync-alt"></i> 주민등록번호 암호화 마이그레이션';
  }
};

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
      alert('담당자 이름을 입력해주세요.');
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

      alert(`담당자가 성공적으로 추가되었습니다!\n\n담당자 코드: ${newCode}\n기본 비밀번호: 0000\n\n※ 담당자는 기본 비밀번호로 로그인 후 본인이 비밀번호를 변경할 수 있습니다.`);
      managerInput.value = '';
      
    } catch (error) {
      console.error('담당자 추가 실패:', error);
      alert('담당자 추가에 실패했습니다: ' + (error.message || error));
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
      if (confirm('정말 삭제하시겠습니까?')) {
        await deleteDoc(doc(db, 'managers', id));
      }
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

  // 담당자 검색 이벤트 리스너
  if (managerSearchInput) {
    managerSearchInput.addEventListener("input", handleManagerSearch);
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

  // 담당자 더보기 버튼 이벤트 리스너
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
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }

  // setupInfiniteScroll(); // 페이지네이션으로 대체
});

// 검색 처리 함수 (고객명, 전화번호, 담당자명 모두 검색)
function handleSearch() {
  const keyword = this.value.trim();
  if (!keyword) {
    renderCards(allClients, true); // reset = true로 처음부터 시작
    return;
  }
  const filtered = allClients.filter(
    (client) =>
      (client.name && client.name.includes(keyword)) ||
      (client.phone && client.phone.replace(/-/g, "").includes(keyword.replace(/-/g, ""))) ||
      (client.manager && client.manager.includes(keyword))
  );
  renderCards(filtered, true); // reset = true로 처음부터 시작
}

// 담당자 검색 처리 함수
function handleManagerSearch() {
  const keyword = this.value.trim();
  if (!keyword) {
    renderManagerCards(managers, true); // reset = true로 처음부터 시작
    return;
  }
  const filtered = managers.filter(
    (manager) =>
      (manager.name && manager.name.includes(keyword)) ||
      (manager.code && manager.code.toLowerCase().includes(keyword.toLowerCase())) ||
      (manager.team && manager.team.includes(keyword)) ||
      (manager.role && manager.role.includes(keyword))
  );
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
    
    alert(errorMessage);
    
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
    displayedClients = [];
    cardList.innerHTML = "";
  }
  
  // 현재 페이지에 표시할 데이터 계산
  const startIndex = currentClientPage * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentPageData = data.slice(startIndex, endIndex);
  
  // 새로운 데이터를 displayedClients에 추가
  displayedClients = displayedClients.concat(currentPageData);
  
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
        alert('담당자를 선택해주세요.');
        return;
      }
      try {
        await updateDoc(doc(db, 'client_info', client.id), { manager: selectedManager });
        client.manager = selectedManager;
        renderCards(allClients, true); // 새로고침
        alert('담당자가 배정되었습니다.');
      } catch (err) {
        alert('담당자 배정에 실패했습니다.');
      }
    });
    cardList.appendChild(card);
  });
  
  // 더보기 버튼 상태 업데이트
  updateClientLoadMoreButton(data, currentClientPage + 1);
  
  // 페이지 카운트 증가
  currentClientPage++;
}

// 고객 더보기 버튼 상태 업데이트
function updateClientLoadMoreButton(allData, nextPage) {
  const loadMoreContainer = document.getElementById('clientLoadMore');
  const loadMoreBtn = document.getElementById('clientLoadMoreBtn');
  const remainingCount = document.getElementById('clientRemainingCount');
  
  if (!loadMoreContainer || !loadMoreBtn || !remainingCount) return;
  
  const totalItems = allData.length;
  const displayedItems = nextPage * ITEMS_PER_PAGE;
  const remaining = Math.max(0, totalItems - displayedItems);
  
  if (remaining > 0) {
    loadMoreContainer.style.display = 'block';
    remainingCount.textContent = remaining;
    loadMoreBtn.disabled = false;
  } else {
    loadMoreContainer.style.display = 'none';
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
    
    // 핸드폰번호 표시 준비
    let phoneDisplay = '';
    if (manager.phone) {
      phoneDisplay = manager.phoneCarrier ? `(${manager.phoneCarrier}) ${manager.phone}` : manager.phone;
    }

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
  
  // 더보기 버튼 상태 업데이트
  updateManagerLoadMoreButton(data, currentManagerPage + 1);
  
  // 페이지 카운트 증가
  currentManagerPage++;
}

// 담당자 더보기 버튼 상태 업데이트
function updateManagerLoadMoreButton(allData, nextPage) {
  const loadMoreContainer = document.getElementById('managerLoadMore');
  const loadMoreBtn = document.getElementById('managerLoadMoreBtn');
  const remainingCount = document.getElementById('managerRemainingCount');
  
  if (!loadMoreContainer || !loadMoreBtn || !remainingCount) return;
  
  const totalItems = allData.length;
  const displayedItems = nextPage * ITEMS_PER_PAGE;
  const remaining = Math.max(0, totalItems - displayedItems);
  
  if (remaining > 0) {
    loadMoreContainer.style.display = 'block';
    remainingCount.textContent = remaining;
    loadMoreBtn.disabled = false;
  } else {
    loadMoreContainer.style.display = 'none';
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
      
      // 전화번호 분리 함수
      function splitPhone(phone) {
        if (!phone) return ['', '', ''];
        const match = phone.match(/(\d{2,3})[-]?(\d{3,4})[-]?(\d{4})/);
        if (match) return [match[1], match[2], match[3]];
        return ['', '', ''];
      }
      const [phone1, phone2, phone3] = splitPhone(client.phone);
      const [companyPhone1, companyPhone2, companyPhone3] = splitPhone(client.companyPhone);
      
      const bodyHtml = `
        <div style='margin-bottom:20px;'><label for="clientInfoNm" class="editClientInfoTitle"><b>성함:</b></label> <input type='text' class="editClientInfoInput" id='edit-name' value='${client.name || ''}' /></div>
        <div style='margin-bottom:20px;'>
          <label for="clientInfoPhoneCarrier" class="editClientInfoTitle"><b>통신사:</b></label> 
          <select class="editClientInfoInput" id='edit-phone-carrier' style='margin-bottom:10px;'>
            <option value="">통신사 선택</option>
            <option value="SKT" ${client.phoneCarrier === 'SKT' ? 'selected' : ''}>SKT</option>
            <option value="KT" ${client.phoneCarrier === 'KT' ? 'selected' : ''}>KT</option>
            <option value="LG U+" ${client.phoneCarrier === 'LG U+' ? 'selected' : ''}>LG U+</option>
            <option value="SKT알뜰" ${client.phoneCarrier === 'SKT알뜰' ? 'selected' : ''}>SKT알뜰</option>
            <option value="KT알뜰" ${client.phoneCarrier === 'KT알뜰' ? 'selected' : ''}>KT알뜰</option>
            <option value="LG알뜰" ${client.phoneCarrier === 'LG알뜰' ? 'selected' : ''}>LG U+알뜰</option>
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
        alert('수정되었습니다.');
        renderDetail(false);
      } catch (err) {
        alert('수정에 실패했습니다.');
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
          alert('파일 다운로드에 실패했습니다.');
          
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
          alert('전체 파일 다운로드에 실패했습니다.');
          
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


// 한글-영문 자판 매핑 테이블 (수정된 버전)
const koreanToEnglishMap = {
  'ㅂ': 'q', 'ㅈ': 'w', 'ㄷ': 'e', 'ㄱ': 'r', 'ㅅ': 't', 'ㅛ': 'y', 'ㅕ': 'u', 'ㅑ': 'i', 'ㅐ': 'o', 'ㅔ': 'p',
  'ㅁ': 'a', 'ㄴ': 's', 'ㅇ': 'd', 'ㄹ': 'f', 'ㅎ': 'g', 'ㅗ': 'h', 'ㅓ': 'j', 'ㅏ': 'k', 'ㅣ': 'l',
  'ㅋ': 'z', 'ㅌ': 'x', 'ㅊ': 'c', 'ㅍ': 'v', 'ㅠ': 'b', 'ㅜ': 'n', 'ㅡ': 'm'
};

const englishToKoreanMap = Object.fromEntries(
  Object.entries(koreanToEnglishMap).map(([k, v]) => [v, k])
);

// 한글을 영문으로 변환 (자모만 처리)
function koreanToEnglish(text) {
  return text.split('').map(char => koreanToEnglishMap[char] || char).join('');
}

// 일반적인 영문→한글 변환 패턴 (미리 정의된 매핑)
const commonPatterns = {
  // 이름 패턴들
  'tjfgml': '설희',
  'zmffhem': '클로드', 
  'rhrjs': '개념',
  'dkssud': '안녕',
  'rufrhkwpsk': '감사합니다',
  'tkdyd': '나는',
  'wpdk': '제발',
  'wjsansrjstn': '전화받아',
  'dusrnrdml': '연예인',
  'qkqhek': 'ㅂㅏㅂㅗ',
  'ehfkwl': '다시',
  'qhdks': 'ㅂㅏㄴㅏ',
  'dhtmxm': '업무',
  // 추가 패턴들...
};

// 한글 자모 조합 함수
function combineJamo(initial, medial, final = '') {
  const HANGUL_BASE = 0xAC00;
  const INITIAL_COUNT = 19;
  const MEDIAL_COUNT = 21;
  const FINAL_COUNT = 28;
  
  const initialIndex = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'].indexOf(initial);
  const medialIndex = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'].indexOf(medial);
  const finalIndex = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'].indexOf(final);
  
  if (initialIndex >= 0 && medialIndex >= 0 && finalIndex >= 0) {
    return String.fromCharCode(HANGUL_BASE + (initialIndex * MEDIAL_COUNT + medialIndex) * FINAL_COUNT + finalIndex);
  }
  
  return initial + medial + final;
}

// 영문을 한글로 변환 (스마트 조합)
function englishToKorean(text) {
  // 1. 미리 정의된 패턴 체크 (전체 매칭)
  if (commonPatterns[text]) {
    return commonPatterns[text];
  }
  
  // 2. 부분 패턴 매칭 (예: tjfgml1! -> 설희1!)
  for (const [pattern, replacement] of Object.entries(commonPatterns)) {
    if (text.startsWith(pattern)) {
      const remaining = text.substring(pattern.length);
      return replacement + remaining;
    }
  }
  
  // 3. 스마트 한글 조합 (초성+중성+종성)
  let result = '';
  let i = 0;
  
  while (i < text.length) {
    const char = text[i];
    
    // 영문이 아닌 경우 그대로 추가
    if (!englishToKoreanMap[char]) {
      result += char;
      i++;
      continue;
    }
    
    // 현재 문자가 영문인 경우 한글 조합 시도
    const jamo1 = englishToKoreanMap[char]; // 초성 후보
    
    // 초성인지 확인
    const isInitial = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'].includes(jamo1);
    
    if (isInitial && i + 1 < text.length) {
      const jamo2 = englishToKoreanMap[text[i + 1]]; // 중성 후보
      const isMedial = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'].includes(jamo2);
      
      if (isMedial) {
        // 종성 확인
        let jamo3 = '';
        if (i + 2 < text.length) {
          const nextJamo = englishToKoreanMap[text[i + 2]];
          const isFinal = ['ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'].includes(nextJamo);
          
          // 다음 글자가 종성이고, 그 다음이 초성이 아닌 경우에만 종성으로 사용
          if (isFinal) {
            const nextNextChar = text[i + 3];
            if (!nextNextChar || !englishToKoreanMap[nextNextChar] || 
                !['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'].includes(englishToKoreanMap[nextNextChar])) {
              jamo3 = nextJamo;
              i += 3;
            } else {
              i += 2;
            }
          } else {
            i += 2;
          }
        } else {
          i += 2;
        }
        
        result += combineJamo(jamo1, jamo2, jamo3);
      } else {
        result += jamo1;
        i++;
      }
    } else {
      result += jamo1;
      i++;
    }
  }
  
  return result;
}


// 비밀번호 정규화 함수 (한글 입력시 영문으로 변환해서 저장)  
function normalizePassword(password) {
  if (!password) return password;
  
  // 한글이 포함된 경우 영문으로 변환
  if (/[가-힣]/.test(password)) {
    return koreanToEnglish(password);
  }
  
  return password;
}

// 패스워드에 자판 변환 힌트 추가
function addKeyboardHint(password) {
  if (!password || password.length < 2) return password;
  
  // 영문 → 한글 변환 시도
  const toKorean = englishToKorean(password);
  if (toKorean !== password && /[가-힣]/.test(toKorean)) {
    // 변환된 한글이 의미있는 패턴인지 간단 체크
    if (toKorean.length >= 1 && toKorean.length <= 10) {
      return `${password}(${toKorean})`;
    }
  }
  
  return password;
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
      
      // 핸드폰번호 표시
      let phoneDisplay = manager.phone || '';
      if (manager.phoneCarrier) {
        phoneDisplay = `(${manager.phoneCarrier}) ` + phoneDisplay;
      }
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
      // 전화번호 분리
      function splitPhone(phone) {
        if (!phone) return ['', '', ''];
        const match = phone.match(/(\d{2,3})[-]?(\d{3,4})[-]?(\d{4})/);
        if (match) return [match[1], match[2], match[3]];
        return ['', '', ''];
      }
      const [phone1, phone2, phone3] = splitPhone(manager.phone);
      
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
              <option value="SKT" ${manager.phoneCarrier === 'SKT' ? 'selected' : ''}>SKT</option>
              <option value="KT" ${manager.phoneCarrier === 'KT' ? 'selected' : ''}>KT</option>
              <option value="LG" ${manager.phoneCarrier === 'LG' ? 'selected' : ''}>LG U+</option>
              <option value="SKT알뜰" ${manager.phoneCarrier === 'SKT알뜰' ? 'selected' : ''}>SKT알뜰</option>
              <option value="KT알뜰" ${manager.phoneCarrier === 'KT알뜰' ? 'selected' : ''}>KT알뜰</option>
              <option value="LG알뜰" ${manager.phoneCarrier === 'LG알뜰' ? 'selected' : ''}>LG U+알뜰</option>
            </select>
          </div>
          <div style='margin-bottom:20px;'><label class="editClientInfoTitle"><b>핸드폰번호:</b></label> 
            <input type='text' class='editClientInfoInputPhone first' id='edit-manager-phone1' value='${phone1}' maxlength='3' /> -
            <input type='text' class='editClientInfoInputPhone middle' id='edit-manager-phone2' value='${phone2}' maxlength='4' /> -
            <input type='text' class='editClientInfoInputPhone last' id='edit-manager-phone3' value='${phone3}' maxlength='4' />
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
  detailModal.style.display = 'block';
  
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
      const phone = [
        document.getElementById('edit-manager-phone1').value,
        document.getElementById('edit-manager-phone2').value,
        document.getElementById('edit-manager-phone3').value
      ].join('-');
      
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
        phoneCarrier: document.getElementById('edit-manager-phone-carrier').value,
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
  const managerSection = document.getElementById('manager-section');
  const managerInfoSection = document.getElementById('manager-info-section');
  const clientSection = document.getElementById('client-section');
  const sidebar = document.getElementById('sidebar');

  if (!menuManagers || !menuManagerInfo || !menuClients || !managerSection || !managerInfoSection || !clientSection || !sidebar) return;

  menuManagers.addEventListener('click', () => {
    // 모달 클래스 정리
    cleanupModalClasses();
    
    menuManagers.classList.add('active');
    menuManagerInfo.classList.remove('active');
    menuClients.classList.remove('active');
    managerSection.style.display = '';
    managerInfoSection.style.display = 'none';
    clientSection.style.display = 'none';
    sidebar.classList.remove('open');
    
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
    // 모달 클래스 정리
    cleanupModalClasses();
    
    menuManagers.classList.remove('active');
    menuManagerInfo.classList.add('active');
    menuClients.classList.remove('active');
    managerSection.style.display = 'none';
    managerInfoSection.style.display = '';
    clientSection.style.display = 'none';
    sidebar.classList.remove('open');
    
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
    // 모달 클래스 정리
    cleanupModalClasses();
    
    menuManagers.classList.remove('active');
    menuManagerInfo.classList.remove('active');
    menuClients.classList.add('active');
    managerSection.style.display = 'none';
    managerInfoSection.style.display = 'none';
    clientSection.style.display = '';
    sidebar.classList.remove('open');
    
    // 담당자 정보 조회 검색창 초기화 및 전체 데이터 표시
    const managerSearchInput = document.getElementById('managerSearchInput');
    if (managerSearchInput) {
      managerSearchInput.value = '';
      renderManagerCards(managers, true); // 전체 담당자 데이터 표시
    }
    
    // 고객 정보 관리 페이지 진입 시 전체 고객 데이터 표시
    renderCards(allClients, true);
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
      const phoneParts = manager.phone ? manager.phone.split('-') : ['', '', ''];
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
            <option value="SKT" ${manager.phoneCarrier === 'SKT' ? 'selected' : ''}>SKT</option>
            <option value="KT" ${manager.phoneCarrier === 'KT' ? 'selected' : ''}>KT</option>
            <option value="LG" ${manager.phoneCarrier === 'LG' ? 'selected' : ''}>LG U+</option>
            <option value="SKT알뜰" ${manager.phoneCarrier === 'SKT알뜰' ? 'selected' : ''}>SKT알뜰</option>
            <option value="KT알뜰" ${manager.phoneCarrier === 'KT알뜰' ? 'selected' : ''}>KT알뜰</option>
            <option value="LG알뜰" ${manager.phoneCarrier === 'LG알뜰' ? 'selected' : ''}>LG U+알뜰</option>
          </select>
        </div>
        
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; font-weight: bold;">핸드폰번호:</label>
          <div style="display: flex; gap: 8px; align-items: center; max-width: 280px;">
            <input type="text" id="field-modal-phone1" value="${phoneParts[0] || ''}" maxlength="3" placeholder="010"
                   style="width: 50px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; text-align: center;" />
            <span style="color: #666;">-</span>
            <input type="text" id="field-modal-phone2" value="${phoneParts[1] || ''}" maxlength="4" placeholder="1234"
                   style="width: 65px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; text-align: center;" />
            <span style="color: #666;">-</span>
            <input type="text" id="field-modal-phone3" value="${phoneParts[2] || ''}" maxlength="4" placeholder="5678"
                   style="width: 65px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; text-align: center;" />
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
            updateData.phone = `${phone1}-${phone2}-${phone3}`;
            updateData.phoneCarrier = carrier;
          } else if (!phone1 && !phone2 && !phone3) {
            updateData.phone = '';
            updateData.phoneCarrier = '';
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
    console.log('엑셀 헤더:', headers);
    
    // 헤더에서 필요한 컬럼 인덱스 찾기
    const columnMapping = findColumnMappings(headers);
    console.log('컬럼 매핑:', columnMapping);
    
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
        if (columnMapping.employeeNumber && row[columnMapping.employeeNumber]) {
          updateData.gaiaId = row[columnMapping.employeeNumber].toString().trim();
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
    
    // 사원번호 찾기 (가이아 아이디로 사용)
    if (headerStr.includes('사원번호') || headerStr.includes('직원번호') || headerStr === '번호' || headerStr === '사원번호') {
      mapping.employeeNumber = index;
      console.log(`사원번호 컬럼 찾음: ${index}`);
    }
    
    // 첫 번째 컬럼이 사원번호인 경우 (PDF 구조 기반)
    if (index === 0 && headerStr === '사원번호') {
      mapping.employeeNumber = index;
      console.log(`첫 번째 컬럼을 사원번호로 설정: ${index}`);
    }
    
    // 보험사 계정 정보 찾기 - 대폭 개선된 매칭 로직
    [...lifeInsuranceCompanies, ...nonLifeInsuranceCompanies].forEach(company => {
      const companyName = company.name.toLowerCase();
      let isMatch = false;
      
      // 다양한 보험사 이름 패턴으로 매칭 시도
      const matchPatterns = [
        companyName, // 전체 이름
        companyName.replace('생명', ''),
        companyName.replace('손해보험', ''),
        companyName.replace('화재', ''),
        companyName.replace('보험', ''),
        companyName.replace('손해', ''),
        companyName.split('')[0] + companyName.split('')[1], // 앞 2글자
        companyName.split('생명')[0], // '생명' 앞부분만
        companyName.split('손해')[0], // '손해' 앞부분만
        companyName.split('화재')[0]  // '화재' 앞부분만
      ];
      
      // 특별 매핑 (PDF에서 자주 쓰이는 축약형)
      const specialMappings = {
        'abl생명': ['abl'],
        'nh농협생명': ['농협생명', 'nh농협', '농협'],
        'im라이프생명': ['im라이프', 'im'],
        'kb생명': ['kb'],
        'kb손해보험': ['kb손해', 'kb손보'],
        'mg손해보험': ['mg손해', 'mg'],
        'db손해보험': ['db손해', 'db'],
        '한화손해보험': ['한화손해'],
        '삼성화재': ['삼성'],
        '현대해상': ['현대'],
        '메리츠화재': ['메리츠'],
        '흥국화재': ['흥국'],
        '롯데손보': ['롯데'],
        '농협손보': ['농협손보', '농협'],
        '하나생명': ['하나'],
        '하나손해': ['하나손해'],
        '라이나손해보험': ['라이나손해', '라이나']
      };
      
      if (specialMappings[companyName]) {
        matchPatterns.push(...specialMappings[companyName]);
      }
      
      // 패턴 매칭 시도
      for (const pattern of matchPatterns) {
        if (pattern && headerStr.includes(pattern)) {
          isMatch = true;
          break;
        }
      }
      
      if (isMatch) {
        if (!mapping.insuranceAccounts[company.key]) {
          mapping.insuranceAccounts[company.key] = {};
        }
        
        console.log(`${company.name} 관련 컬럼 찾음: ${headerStr} (인덱스: ${index})`);
        
        // 사원번호/아이디 관련 (기본값)
        if (!headerStr.includes('비밀번호') && !headerStr.includes('password') && 
            !headerStr.includes('패스워드') && !headerStr.includes('pw')) {
          mapping.insuranceAccounts[company.key].employeeId = index;
          console.log(`${company.name} 사원번호: ${index}`);
        }
        // 비밀번호 관련
        else {
          mapping.insuranceAccounts[company.key].password = index;
          console.log(`${company.name} 비밀번호: ${index}`);
        }
      }
    });
  });
  
  console.log('최종 컬럼 매핑:', mapping);
  return mapping;
}

 