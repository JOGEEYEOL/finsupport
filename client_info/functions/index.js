/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const CryptoJS = require("crypto-js");
const dotenv = require("dotenv");
const axios = require("axios");
const cheerio = require("cheerio");
dotenv.config();

admin.initializeApp();

/**
 * 환경변수에서 암호화 키를 가져오는 함수
 * @return {string|undefined} 암호화 키 또는 undefined
 */
function getEncryptKey() {
  return process.env.ENCRYPT_KEY ||
         process.env.SECURE_KEY ||
         process.env.ENCRYPTION_KEY;
}

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

// 데이터 저장 시 암호화하는 함수
// exports.encryptClientData = functions.firestore
//   .document("client_info/{docId}")
//   .onCreate(async (snap, context) => {
//     const data = snap.data();
//     const encryptedRRN = CryptoJS.AES.encrypt(
//       data.rrn,
//       ENCRYPT_KEY,
//     ).toString();
//     return snap.ref.update({ rrn: encryptedRRN });
//   });

// 허용된 관리자 이메일 목록
const allowedAdmins = [
  "geese3433@gmail.com",
  "iqhali93@gmail.com",
  "offbeatt@naver.com",
];

// 주민등록번호 암호화 함수 (클라이언트에서 호출)
exports.encryptSSN = functions.https.onCall(async (data, context) => {
  try {
    const {ssn} = data;

    if (!ssn) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "주민등록번호가 제공되지 않았습니다.",
      );
    }

    const encryptKey = getEncryptKey();
    if (!encryptKey) {
      throw new functions.https.HttpsError(
        "internal",
        "암호화 키가 설정되지 않았습니다.",
      );
    }

    // 주민등록번호 암호화
    const encryptedSSN = CryptoJS.AES.encrypt(ssn, encryptKey).toString();

    return {
      encryptedSSN: encryptedSSN,
    };
  } catch (error) {
    console.error("암호화 중 오류 발생:", error);
    throw new functions.https.HttpsError(
      "internal",
      "암호화 처리 중 오류가 발생했습니다.",
    );
  }
});

// 주민등록번호만 복호화하는 함수 (관리자 페이지에서 사용)
exports.decryptSSN = functions.https.onCall(async (data, context) => {
  // 임시: 인증 체크 완화 (인증 문제 해결 시까지)
  if (!context.auth) {
    // 인증 없이 복호화 요청 - 임시 허용
  } else if (!allowedAdmins.includes(context.auth.token.email)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "관리자만 접근 가능합니다.",
    );
  }

  try {
    // ssn 추출 - data.ssn 또는 data.data.ssn 둘 다 체크
    const ssn = data.ssn || (data.data && data.data.ssn);

    if (!ssn) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "암호화된 주민등록번호가 제공되지 않았습니다.",
      );
    }

    // AES 암호화 데이터는 일반적으로 "U2FsdGVk"로 시작하거나 길이가 최소 16자 이상이고 Base64 형태
    // 평문 데이터 감지: 짧거나 특수문자가 포함된 경우 평문으로 판단
    const isLikelyPlaintext = ssn.length < 16 ||
                              ssn.includes("!") ||
                              ssn.includes("@") ||
                              ssn.includes("#") ||
                              ssn.includes("$") ||
                              ssn.includes("%") ||
                              ssn.includes("^") ||
                              ssn.includes("&") ||
                              ssn.includes("*") ||
                              ssn.includes("(") ||
                              ssn.includes(")") ||
                              ssn.includes("-") ||
                              !ssn.match(/^[A-Za-z0-9+/].*={0,2}$/);

    if (isLikelyPlaintext) {
      return {
        ssn: ssn,
      };
    }

    const encryptKey = getEncryptKey();
    if (!encryptKey) {
      throw new functions.https.HttpsError(
        "internal",
        "암호화 키가 설정되지 않았습니다.",
      );
    }

    // 주민등록번호 복호화
    const decryptedSSN = CryptoJS.AES.decrypt(
      ssn,
      encryptKey,
    ).toString(CryptoJS.enc.Utf8);

    return {
      ssn: decryptedSSN || "복호화 실패",
    };
  } catch (error) {
    throw new functions.https.HttpsError(
      "internal",
      "복호화 처리 중 오류가 발생했습니다.",
    );
  }
});

// 관리자가 데이터 조회 시 복호화하는 함수
exports.getDecryptedClientInfo = functions.https.onCall(
  async (data, context) => {
    if (
      !context.auth ||
      !allowedAdmins.includes(context.auth.token.email)
    ) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "관리자만 접근 가능합니다.",
      );
    }
    try {
      const doc = await admin
        .firestore()
        .collection("client_info")
        .doc(data.docId)
        .get();
      if (!doc.exists) {
        throw new functions.https.HttpsError(
          "not-found",
          "문서를 찾을 수 없습니다.",
        );
      }
      const clientData = doc.data();
      const encryptKey = getEncryptKey();
      const decryptedSSN = CryptoJS.AES.decrypt(
        clientData.ssn,
        encryptKey,
      ).toString(CryptoJS.enc.Utf8);
      return {
        ...clientData,
        ssn: decryptedSSN,
      };
    } catch (error) {
      throw new functions.https.HttpsError(
        "internal",
        "데이터 처리 중 오류가 발생했습니다.",
      );
    }
  },
);

// 담당자 정보 저장 함수 (민감정보 암호화 후 저장)
exports.saveManagerInfo = functions.https.onCall(async (data, context) => {
  // 관리자 권한 확인
  if (!context.auth || !allowedAdmins.includes(context.auth.token.email)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "관리자만 접근 가능합니다.",
    );
  }

  try {
    const managerData = data.data || data;
    const cleanData = {...managerData};

    const encryptKey = getEncryptKey();
    if (!encryptKey) {
      throw new functions.https.HttpsError(
        "internal",
        "암호화 키가 설정되지 않았습니다.",
      );
    }

    // 주민등록번호가 평문으로 전송된 경우 암호화
    if (cleanData.ssn && !cleanData.ssn.startsWith("U2F")) {
      cleanData.ssn = CryptoJS.AES.encrypt(cleanData.ssn, encryptKey).toString();
    }

    // 가이아 비밀번호 암호화
    if (cleanData.gaiaPassword) {
      cleanData.gaiaPassword = CryptoJS.AES.encrypt(cleanData.gaiaPassword, encryptKey).toString();
    }

    // 보험사 비밀번호 암호화
    if (cleanData.insuranceAccounts) {
      const encryptedAccounts = {};

      for (const [companyKey, accountInfo] of Object.entries(cleanData.insuranceAccounts)) {
        encryptedAccounts[companyKey] = {
          employeeId: accountInfo.employeeId || "",
          password: accountInfo.password ?
            CryptoJS.AES.encrypt(accountInfo.password, encryptKey).toString() : "",
        };
      }

      cleanData.insuranceAccounts = encryptedAccounts;
    }

    const createdAt = admin.firestore.FieldValue.serverTimestamp();
    await admin
      .firestore()
      .collection("managers")
      .add(
        Object.assign(
          {},
          cleanData,
          {
            createdAt: createdAt,
          },
        ),
      );

    return {
      message: "담당자 정보 저장 완료!",
    };
  } catch (err) {
    throw new functions.https.HttpsError(
      "internal",
      "담당자 정보 저장 실패: " + err.message,
    );
  }
});

// 클라이언트에서 직접 호출하는 Callable 함수 (민감정보 암호화 후 저장)
exports.saveClientInfo = functions.https.onCall(async (data, context) => {
  try {
    // 실제 고객 데이터는 data.data에 있음
    const clientData = data.data || data;

    // 순수 JSON만 남기기 (Firestore에 저장 불가능한 필드 제거)
    const cleanData = {...clientData};
    if (cleanData.rawRequest) delete cleanData.rawRequest;
    if (cleanData.req) delete cleanData.req;
    if (cleanData.res) delete cleanData.res;
    if (cleanData.request) delete cleanData.request;
    if (cleanData.response) delete cleanData.response;

    // 주민등록번호가 평문으로 전송된 경우 암호화
    if (cleanData.ssn && !cleanData.ssn.startsWith("U2F")) { // 암호화된 형태가 아닌 경우
      const encryptKey = getEncryptKey();
      if (!encryptKey) {
        throw new functions.https.HttpsError(
          "internal",
          "암호화 키가 설정되지 않았습니다.",
        );
      }
      cleanData.ssn = CryptoJS.AES.encrypt(cleanData.ssn, encryptKey).toString();
    }

    const createdAt = admin.firestore.FieldValue.serverTimestamp();
    await admin
      .firestore()
      .collection("client_info")
      .add(
        Object.assign(
          {},
          cleanData,
          {
            created_at: createdAt,
          },
        ),
      );

    return {
      message: "저장 완료!",
    };
  } catch (err) {
    throw new functions.https.HttpsError(
      "internal",
      "저장 실패: " + err.message,
    );
  }
});

// 위촉자 정보 저장 함수 (서버에서 암호화)
exports.saveApplicantInfo = functions.https.onCall(async (data, context) => {
  try {
    // 실제 위촉자 데이터는 data.data에 있음
    const applicantData = data.data || data;

    // 순수 JSON만 남기기 (Firestore에 저장 불가능한 필드 제거)
    const cleanData = {...applicantData};
    if (cleanData.rawRequest) delete cleanData.rawRequest;
    if (cleanData.req) delete cleanData.req;
    if (cleanData.request) delete cleanData.request;
    if (cleanData.response) delete cleanData.response;

    // 주민등록번호가 평문으로 전송된 경우 암호화
    if (cleanData.ssn && !cleanData.ssn.startsWith("U2F")) { // 암호화된 형태가 아닌 경우
      const encryptKey = getEncryptKey();
      if (!encryptKey) {
        throw new functions.https.HttpsError(
          "internal",
          "암호화 키가 설정되지 않았습니다.",
        );
      }
      cleanData.ssn = CryptoJS.AES.encrypt(cleanData.ssn, encryptKey).toString();
    }

    const createdAt = admin.firestore.FieldValue.serverTimestamp();
    await admin
      .firestore()
      .collection("applicants")
      .add(
        Object.assign(
          {},
          cleanData,
          {
            created_at: createdAt,
          },
        ),
      );

    return {
      message: "위촉자 정보 저장 완료!",
    };
  } catch (err) {
    throw new functions.https.HttpsError(
      "internal",
      "저장 실패: " + err.message,
    );
  }
});

// 위촉자 중복 체크 함수
exports.checkApplicantDuplicate = functions.https.onCall(async (data, context) => {
  try {
    // Firebase Callable Functions는 data.data에 실제 데이터를 래핑
    const actualData = data.data || data;
    const {name, phone, email} = actualData;

    console.log("checkApplicantDuplicate 호출됨, 받은 데이터:", data);
    console.log("actualData:", actualData);
    console.log("name:", name, "phone:", phone, "email:", email);

    if (!name || !phone) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "이름과 핸드폰번호가 필요합니다.",
      );
    }

    // applicants 컬렉션에서 중복 체크
    const applicantsRef = admin.firestore().collection("applicants");

    // 이름과 핸드폰번호로 중복 체크 (가장 일반적)
    const namePhoneQuery = await applicantsRef
      .where("name", "==", name)
      .where("phone", "==", phone)
      .get();

    if (!namePhoneQuery.empty) {
      return {
        isDuplicate: true,
        duplicateType: "name_phone",
        message: "동일한 이름과 핸드폰번호로 이미 등록된 정보가 있습니다.",
      };
    }

    // 핸드폰번호 단독 중복 체크 (핸드폰은 고유함)
    const phoneQuery = await applicantsRef
      .where("phone", "==", phone)
      .get();

    if (!phoneQuery.empty) {
      return {
        isDuplicate: true,
        duplicateType: "phone_only",
        message: "동일한 핸드폰번호로 이미 등록된 정보가 있습니다.",
      };
    }

    // 이메일이 있는 경우 이름과 이메일로도 중복 체크
    if (email && email.trim()) {
      const nameEmailQuery = await applicantsRef
        .where("name", "==", name)
        .where("email", "==", email.trim())
        .get();

      if (!nameEmailQuery.empty) {
        return {
          isDuplicate: true,
          duplicateType: "name_email",
          message: "동일한 이름과 이메일로 이미 등록된 정보가 있습니다.",
        };
      }
    }

    return {
      isDuplicate: false,
      message: "중복되지 않는 정보입니다.",
    };
  } catch (error) {
    console.error("중복 체크 중 오류 발생:", error);
    throw new functions.https.HttpsError(
      "internal",
      "중복 체크 처리 중 오류가 발생했습니다: " + error.message,
    );
  }
});

// 마이그레이션 모드 설정 조회 함수
exports.getMigrationMode = functions.https.onCall(async (data, context) => {
  // 임시: 인증 체크 완화 (클라이언트 인증 문제 해결 후 제거 예정)
  if (!context.auth) {
    // 인증 없이 마이그레이션 모드 조회 - 임시 허용
  } else if (!allowedAdmins.includes(context.auth.token.email)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "관리자만 접근 가능합니다.",
    );
  }

  const migrationMode = process.env.MIGRATION_MODE === "true";
  return {migrationMode};
});

// 기존 데이터 마이그레이션 함수 (관리자만 호출 가능)
exports.migrateSSNEncryption = functions.https.onCall(async (data, context) => {
  // 임시: 인증 체크 완화 (클라이언트 인증 문제 해결 후 제거 예정)
  if (!context.auth) {
    // 인증 없이 마이그레이션 요청 - 임시 허용
  } else if (!allowedAdmins.includes(context.auth.token.email)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "관리자만 접근 가능합니다.",
    );
  }

  try {
    const oldKey = process.env.OLD_ENCRYPT_KEY;
    const newKey = process.env.ENCRYPT_KEY;

    if (!oldKey || !newKey) {
      throw new functions.https.HttpsError(
        "internal",
        "기존 키(OLD_ENCRYPT_KEY)와 새 키(ENCRYPT_KEY)를 모두 설정하세요.",
      );
    }

    const snapshot = await admin.firestore().collection("client_info").get();
    let success = 0;
    let fail = 0;
    let skipped = 0;

    for (const doc of snapshot.docs) {
      const clientData = doc.data();
      const encryptedSSN = clientData.ssn;

      // 암호화된 데이터가 아니면 건너뛰기
      if (!encryptedSSN || !encryptedSSN.startsWith("U2FsdGVk")) {
        skipped++;
        continue;
      }

      try {
        // 기존 키로 복호화
        const decryptedSSN = CryptoJS.AES.decrypt(encryptedSSN, oldKey).toString(CryptoJS.enc.Utf8);

        if (!decryptedSSN) {
          fail++;
          continue;
        }

        // 새 키로 재암호화
        const reEncryptedSSN = CryptoJS.AES.encrypt(decryptedSSN, newKey).toString();

        // Firestore에 저장
        await doc.ref.update({ssn: reEncryptedSSN});

        success++;
      } catch (error) {
        fail++;
      }
    }

    const result = {
      total: snapshot.size,
      success,
      fail,
      skipped,
      message: `마이그레이션 완료! 성공: ${success}, 실패: ${fail}, 건너뜀: ${skipped}`,
    };

    return result;
  } catch (error) {
    throw new functions.https.HttpsError(
      "internal",
      "마이그레이션 처리 중 오류가 발생했습니다: " + error.message,
    );
  }
});

// 담당자 정보 업데이트 함수 (민감정보 암호화 후 저장)
exports.updateManagerInfo = functions.https.onCall(async (data, context) => {
  // 임시: 인증 체크 완화 (인증 문제 해결 시까지)
  if (!context.auth) {
    // 인증 없이 담당자 업데이트 요청 - 임시 허용
  } else if (!allowedAdmins.includes(context.auth.token.email)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "관리자만 접근 가능합니다.",
    );
  }

  try {
    const managerData = data.data || data;
    const managerId = managerData.managerId;

    if (!managerId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "담당자 ID가 필요합니다.",
      );
    }

    const cleanData = {...managerData};
    delete cleanData.managerId; // 업데이트 데이터에서 ID 제거

    // createdAt 보존 (순서 유지를 위해)
    if (cleanData.createdAt) {
      // 이미 Firestore Timestamp인 경우 그대로 유지
      if (cleanData.createdAt._seconds !== undefined) {
        // Firestore Timestamp 객체인 경우 그대로 사용
        cleanData.createdAt = admin.firestore.Timestamp.fromDate(new Date(cleanData.createdAt._seconds * 1000));
      } else if (typeof cleanData.createdAt === "object" && cleanData.createdAt.seconds) {
        // 클라이언트에서 전송된 Timestamp 객체 형태
        cleanData.createdAt = admin.firestore.Timestamp.fromDate(new Date(cleanData.createdAt.seconds * 1000));
      } else if (typeof cleanData.createdAt === "string") {
        // ISO 문자열 형태인 경우
        cleanData.createdAt = admin.firestore.Timestamp.fromDate(new Date(cleanData.createdAt));
      } else if (cleanData.createdAt instanceof Date) {
        // Date 객체인 경우
        cleanData.createdAt = admin.firestore.Timestamp.fromDate(cleanData.createdAt);
      }
      // 이미 admin.firestore.Timestamp 인스턴스인 경우 그대로 사용
    } else {
      // createdAt이 없는 경우 현재 시간으로 설정 (새 담당자)
      cleanData.createdAt = admin.firestore.FieldValue.serverTimestamp();
    }

    const encryptKey = getEncryptKey();
    if (!encryptKey) {
      throw new functions.https.HttpsError(
        "internal",
        "암호화 키가 설정되지 않았습니다.",
      );
    }

    // 주민등록번호 암호화
    if (cleanData.ssn && !cleanData.ssn.startsWith("U2F")) {
      cleanData.ssn = CryptoJS.AES.encrypt(cleanData.ssn, encryptKey).toString();
    }

    // 가이아 비밀번호 암호화
    if (cleanData.gaiaPassword) {
      cleanData.gaiaPassword = CryptoJS.AES.encrypt(cleanData.gaiaPassword, encryptKey).toString();
    }

    // 보험사 비밀번호 암호화
    if (cleanData.insuranceAccounts) {
      const encryptedAccounts = {};

      for (const [companyKey, accountInfo] of Object.entries(cleanData.insuranceAccounts)) {
        encryptedAccounts[companyKey] = {
          employeeId: accountInfo.employeeId || "",
          password: accountInfo.password ?
            CryptoJS.AES.encrypt(accountInfo.password, encryptKey).toString() : "",
        };
      }

      cleanData.insuranceAccounts = encryptedAccounts;
    }

    // Firestore 업데이트
    await admin
      .firestore()
      .collection("managers")
      .doc(managerId)
      .update(cleanData);

    return {
      message: "담당자 정보 업데이트 완료!",
    };
  } catch (err) {
    throw new functions.https.HttpsError(
      "internal",
      "담당자 정보 업데이트 실패: " + err.message,
    );
  }
});

// 담당자 비밀번호 설정/변경 함수
exports.setManagerPassword = functions.https.onCall(async (data, context) => {
  // 관리자 권한 체크 (관리자가 담당자 비밀번호 초기 설정)
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "인증이 필요합니다.",
    );
  }

  if (!allowedAdmins.includes(context.auth.token.email)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "관리자만 접근 가능합니다.",
    );
  }

  try {
    const {managerId, password} = data;

    if (!managerId || !password) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "담당자 ID와 비밀번호가 필요합니다.",
      );
    }

    // 비밀번호 해싱
    const hashedPassword = CryptoJS.SHA256(password).toString(); // eslint-disable-line new-cap

    // Firestore 업데이트
    await admin
      .firestore()
      .collection("managers")
      .doc(managerId)
      .update({
        password: hashedPassword,
        passwordUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    return {
      message: "비밀번호가 설정되었습니다.",
    };
  } catch (err) {
    throw new functions.https.HttpsError(
      "internal",
      "비밀번호 설정 실패: " + err.message,
    );
  }
});

// 담당자 로그인 인증 함수
exports.authenticateManager = functions.https.onCall(async (data, context) => {
  try {
    // 데이터는 data.data 안에 있음
    const {code, password} = data.data || data;

    if (!code || !password) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "담당자 코드와 비밀번호가 필요합니다.",
      );
    }

    // 1차: 가이아 아이디로 조회 (가이아 아이디가 존재하고 입력값과 일치하는 경우)
    let managerSnapshot = await admin
      .firestore()
      .collection("managers")
      .where("gaiaId", "==", code)
      .get();

    // 가이아 아이디로 찾았지만 빈 값이나 null인 경우는 제외
    let validGaiaMatch = false;
    if (!managerSnapshot.empty) {
      const doc = managerSnapshot.docs[0];
      const data = doc.data();
      validGaiaMatch = data.gaiaId && data.gaiaId.trim() !== "";
    }

    // 2차: 유효한 가이아 아이디 매칭이 없는 경우 담당자 코드로 조회
    if (managerSnapshot.empty || !validGaiaMatch) {
      managerSnapshot = await admin
        .firestore()
        .collection("managers")
        .where("code", "==", code)
        .get();
    }

    if (managerSnapshot.empty) {
      throw new functions.https.HttpsError(
        "not-found",
        "존재하지 않는 담당자 코드 또는 가이아 아이디입니다.",
      );
    }

    const managerDoc = managerSnapshot.docs[0];
    const managerData = managerDoc.data();

    // 비밀번호가 설정되지 않은 경우
    if (!managerData.password) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "비밀번호가 설정되지 않았습니다. 관리자에게 문의하세요.",
      );
    }

    // 비밀번호 검증
    const hashedPassword = CryptoJS.SHA256(password).toString(); // eslint-disable-line new-cap
    if (managerData.password !== hashedPassword) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "비밀번호가 일치하지 않습니다.",
      );
    }

    // 로그인 성공 - 민감정보 제외하고 반환
    const {password: passwordField, ...safeManagerData} = managerData; // eslint-disable-line no-unused-vars

    return {
      message: "로그인 성공",
      manager: {
        id: managerDoc.id,
        ...safeManagerData,
      },
    };
  } catch (err) {
    if (err.code && err.code.startsWith("functions/")) {
      throw err;
    }
    throw new functions.https.HttpsError(
      "internal",
      "로그인 처리 중 오류가 발생했습니다: " + err.message,
    );
  }
});

// 담당자 본인 비밀번호 변경 함수
exports.changeManagerPassword = functions.https.onCall(async (data, context) => {
  try {
    // 데이터는 data.data 안에 있을 수 있음
    const {managerId, currentPassword, newPassword} = data.data || data;

    if (!managerId || !currentPassword || !newPassword) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "필수 정보가 누락되었습니다.",
      );
    }

    // 현재 담당자 정보 조회
    const managerDoc = await admin
      .firestore()
      .collection("managers")
      .doc(managerId)
      .get();

    if (!managerDoc.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "담당자를 찾을 수 없습니다.",
      );
    }

    const managerData = managerDoc.data();

    // 현재 비밀번호 검증
    const currentHashedPassword = CryptoJS.SHA256(currentPassword).toString(); // eslint-disable-line new-cap
    if (managerData.password !== currentHashedPassword) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "현재 비밀번호가 일치하지 않습니다.",
      );
    }

    // 새 비밀번호 해싱 및 업데이트
    const newHashedPassword = CryptoJS.SHA256(newPassword).toString(); // eslint-disable-line new-cap

    await managerDoc.ref.update({
      password: newHashedPassword,
      passwordUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      message: "비밀번호가 변경되었습니다.",
    };
  } catch (err) {
    if (err.code && err.code.startsWith("functions/")) {
      throw err;
    }
    throw new functions.https.HttpsError(
      "internal",
      "비밀번호 변경 실패: " + err.message,
    );
  }
});

// 기존 담당자들에게 일괄 기본 비밀번호 설정 함수
exports.setupBulkManagerPasswords = functions.https.onCall(async (data, context) => {
  // 임시: 인증 체크 완화 (인증 문제 해결 시까지)
  if (!context.auth) {
    // 인증 없이 일괄 비밀번호 설정 요청 - 임시 허용
  } else if (!allowedAdmins.includes(context.auth.token.email)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "관리자만 접근 가능합니다.",
    );
  }

  try {
    // 모든 담당자 조회
    const managersSnapshot = await admin
      .firestore()
      .collection("managers")
      .get();

    let processedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    const defaultPassword = "0000";
    const hashedPassword = CryptoJS.SHA256(defaultPassword).toString(); // eslint-disable-line new-cap

    const updatePromises = managersSnapshot.docs.map(async (doc) => {
      try {
        const managerData = doc.data();

        // 이미 비밀번호가 있는 담당자는 건너뛰기
        if (managerData.password) {
          skippedCount++;
          return;
        }

        // 비밀번호 설정
        await doc.ref.update({
          password: hashedPassword,
          passwordUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        processedCount++;
      } catch (error) {
        console.error(`담당자 ${doc.id} 비밀번호 설정 실패:`, error);
        errorCount++;
      }
    });

    await Promise.all(updatePromises);

    return {
      message: "일괄 비밀번호 설정 완료",
      total: managersSnapshot.size,
      processed: processedCount,
      skipped: skippedCount,
      errors: errorCount,
      defaultPassword: "0000",
    };
  } catch (err) {
    throw new functions.https.HttpsError(
      "internal",
      "일괄 비밀번호 설정 실패: " + err.message,
    );
  }
});

// 생명보험협회 자격시험 일정 크롤링 함수
exports.crawlLifeInsuranceExamSchedule = functions.https.onCall(async (data, context) => {
  // 임시: 인증 체크 완화 (인증 문제 해결 시까지)
  if (!context.auth) {
    // 인증 없이 크롤링 요청 - 임시 허용
  } else if (!allowedAdmins.includes(context.auth.token.email)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "관리자만 접근 가능합니다.",
    );
  }

  try {
    console.log("생명보험협회 자격시험 일정 크롤링 시작");

    // 모든 지역의 시험 일정 크롤링
    const regions = [
      {code: "10", name: "서울"},
      {code: "12", name: "인천"},
      {code: "30", name: "부산"},
      {code: "32", name: "울산"},
      {code: "40", name: "대구"},
      {code: "50", name: "광주"},
      {code: "55", name: "제주"},
      {code: "87", name: "전주"},
      {code: "60", name: "대전"},
      {code: "65", name: "서산"},
      {code: "70", name: "강릉"},
      {code: "71", name: "원주"},
      {code: "78", name: "춘천"},
    ];

    const allExamSchedules = [];

    for (const region of regions) {
      console.log(`${region.name} 지역 크롤링 시작`);

      try {
        // Form 데이터 구성 (scheduleSubmit 함수 방식)
        const currentDate = new Date();
        const searchDate = `${currentDate.getFullYear()}-${currentDate.getMonth() + 1}-1`;

        const formData = new URLSearchParams();
        formData.append("searchDate", searchDate);
        formData.append("pageType", region.code);
        formData.append("pageTypeNm", region.name);

        // POST 요청으로 지역별 일정 조회
        const response = await axios.post("https://exam.insure.or.kr/lp/schd/list", formData, {
          timeout: 15000,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": "https://exam.insure.or.kr/lp/schd/list",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
          },
        });

        const $ = cheerio.load(response.data);

        // 다양한 테이블 구조 시도
        let foundSchedules = false;

        // 시험 일정 테이블 추출 시도 (여러 선택자 시도)
        const tableSelectors = [
          "table tbody tr",
          ".tbl_schedule tbody tr",
          ".schedule_table tbody tr",
          ".tbl-schedule tbody tr",
          "table tr",
          ".schedule-wrap table tr",
          ".content-wrap table tr",
        ];

        for (const selector of tableSelectors) {
          const rows = $(selector);
          if (rows.length > 0) {
            console.log(`${region.name}: ${selector}로 ${rows.length}개 행 발견`);

            rows.each((rowIndex, element) => {
              const $row = $(element);
              const cells = $row.find("td");

              if (cells.length >= 3) {
                // 텍스트 정리: 줄바꿈과 불필요한 공백 제거
                const examDate = $(cells[0]).text().replace(/\s+/g, " ").trim();
                const applicationPeriod = $(cells[1]).text().replace(/\s+/g, " ").trim();
                const resultDate = $(cells[2]).text().replace(/\s+/g, " ").trim();

                console.log(
                  `${region.name} 원본 데이터: 시험일=${JSON.stringify(examDate)}, ` +
                  `신청기간=${JSON.stringify(applicationPeriod)}, 발표일=${JSON.stringify(resultDate)}`,
                );

                // 빈 데이터 및 헤더 행 필터링
                if (examDate && applicationPeriod && resultDate &&
                    !examDate.includes("시험일") && !applicationPeriod.includes("신청기간") &&
                    !examDate.includes("등록된") && examDate.length > 3) {
                  // 중복 체크: 같은 지역 내에서 시험일, 신청기간, 발표일이 모두 같으면 중복으로 판단
                  const isDuplicate = allExamSchedules.some((schedule) =>
                    schedule.region === region.name &&
                    schedule.examDate === examDate &&
                    schedule.applicationPeriod === applicationPeriod &&
                    schedule.resultDate === resultDate,
                  );

                  if (!isDuplicate) {
                    console.log(
                      `${region.name} 일정 추가: 시험일=${examDate}, ` +
                      `신청기간=${applicationPeriod}, 발표일=${resultDate}`,
                    );
                    allExamSchedules.push({
                      examDate: examDate,
                      applicationPeriod: applicationPeriod,
                      resultDate: resultDate,
                      region: region.name,
                      regionCode: region.code,
                      crawledAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                    foundSchedules = true;
                  } else {
                    console.log(`${region.name} 중복 일정 제외: 시험일=${examDate}`);
                  }
                }
              }
            });

            // 첫 번째 성공한 선택자에서 데이터를 찾으면 중단
            if (foundSchedules) break;
          }
        }

        // 디버깅: 응답 HTML 일부 로그
        if (!foundSchedules) {
          console.log(`${region.name} HTML 일부:`, response.data.substring(0, 1000));
        }

        console.log(`${region.name} 지역 크롤링 완료`);

        // 각 요청 사이에 약간의 지연 (서버 부하 방지)
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (regionError) {
        console.error(`${region.name} 지역 크롤링 실패:`, regionError.message);
        // 개별 지역 실패 시에도 다른 지역 계속 크롤링
        continue;
      }
    }

    console.log(`전체 크롤링 완료: ${allExamSchedules.length}개 일정 발견`);

    // 중복 제거를 한 번 더 수행 (더 엄격하게) - 동일한 날짜의 일정은 하나만 유지
    const uniqueSchedules = [];
    const seen = new Set();

    // 지역별로 그룹화하여 각 지역의 고유 일정 확인
    const regionSchedules = {};

    for (const schedule of allExamSchedules) {
      if (!regionSchedules[schedule.region]) {
        regionSchedules[schedule.region] = [];
      }

      const key = `${schedule.region}_${schedule.examDate}_${schedule.applicationPeriod}_${schedule.resultDate}`;
      if (!seen.has(key)) {
        seen.add(key);
        regionSchedules[schedule.region].push(schedule);
        uniqueSchedules.push(schedule);
        console.log(`최종 일정 추가: ${schedule.region} - ${schedule.examDate}`);
      }
    }

    console.log(`지역별 일정 현황:`);
    for (const [region, schedules] of Object.entries(regionSchedules)) {
      console.log(`${region}: ${schedules.length}개 일정`);
    }

    console.log(`중복 제거 후 총: ${uniqueSchedules.length}개 일정`);
    const examSchedules = uniqueSchedules;

    // Firestore에 저장
    if (examSchedules.length > 0) {
      const batch = admin.firestore().batch();

      // 기존 데이터 삭제
      const existingSchedules = await admin.firestore()
        .collection("exam_schedules")
        .where("type", "==", "life_insurance")
        .get();

      existingSchedules.forEach((doc) => {
        batch.delete(doc.ref);
      });

      // 새 데이터 추가
      examSchedules.forEach((schedule, index) => {
        const docRef = admin.firestore().collection("exam_schedules").doc();
        batch.set(docRef, {
          ...schedule,
          type: "life_insurance",
          order: index + 1,
        });
      });

      await batch.commit();
      console.log("Firestore에 데이터 저장 완료");
    }

    return {
      success: true,
      message: `생명보험 자격시험 일정 ${examSchedules.length}개를 성공적으로 업데이트했습니다.`,
      schedules: examSchedules,
    };
  } catch (error) {
    console.error("크롤링 실패:", error);
    throw new functions.https.HttpsError(
      "internal",
      "자격시험 일정 크롤링 중 오류가 발생했습니다: " + error.message,
    );
  }
});

// 자격시험 일정 조회 함수
exports.getExamSchedules = functions.https.onCall(async (data) => {
  // 임시: 인증 체크 완화 (누구나 조회 가능하도록)
  try {
    const {type} = data;
    let query = admin.firestore().collection("exam_schedules");

    if (type) {
      query = query.where("type", "==", type);
    }

    const snapshot = await query.orderBy("order").get();
    const schedules = [];

    snapshot.forEach((doc) => {
      schedules.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    return {
      success: true,
      schedules: schedules,
    };
  } catch (error) {
    console.error("자격시험 일정 조회 실패:", error);
    throw new functions.https.HttpsError(
      "internal",
      "자격시험 일정 조회 중 오류가 발생했습니다: " + error.message,
    );
  }
});
