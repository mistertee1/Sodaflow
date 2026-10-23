import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { getFirestore, initializeFirestore, memoryLocalCache, type Firestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export { firebaseConfig };

// Initialize Firebase App
export const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Initialize Analytics (supported in browser environments)
export let analytics: Analytics | undefined;
if (typeof window !== 'undefined') {
  isSupported()
    .then((supported) => {
      if (supported) {
        analytics = getAnalytics(app);
      }
    })
    .catch(() => {
      // Analytics not supported in this runtime
    });
}
export { getAnalytics };

export const auth = getAuth(app);
const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
let firestore: Firestore;
try {
  // Preserve the legacy client's transport on restricted mobile/proxy networks.
  firestore = initializeFirestore(app, { experimentalForceLongPolling: true, localCache: memoryLocalCache() }, databaseId);
} catch (error) {
  // Vite HMR can retain a Firestore instance initialized before this module reloads.
  if ((error as { code?: string }).code !== 'failed-precondition') throw error;
  firestore = getFirestore(app, databaseId);
}
export const db = firestore;
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

export const isIframeEnvironment = (): boolean => {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
};

export function normalizeLoginIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error: any) {
    const code = error?.code || 'unknown';
    console.warn('Google sign-in popup notice:', code, error?.message);
    const host = typeof window !== 'undefined' ? window.location.hostname : 'النطاق الحالي';
    if (code === 'auth/operation-not-allowed') {
      error.friendlyMessage = 'تسجيل الدخول عبر Google غير مفعّل في لوحة تحكم مشروعك Firebase (sodaflow). يرجى فتح Firebase Console > Authentication > Sign-in method والضغط على Google ثم تفعيله (Enable) وتحديد بريد دعم المشروع.';
    } else if (code === 'auth/unauthorized-domain') {
      error.friendlyMessage = `النطاق الحالي (${host}) غير مصرح به في Firebase. يرجى إضافته في Firebase Console > Authentication > Settings > Authorized domains.`;
    } else if (code === 'auth/network-request-failed') {
      error.friendlyMessage = 'تعذر فتح نافذة Google للمصادقة من داخل إطار المعاينة المضمن (بسبب قيود المتصفح على ملفات تعريف الارتباط للطرف الثالث). يمكنك فتح التطبيق في نافذة مستقلة، أو تسجيل الدخول بالبريد الإلكتروني، ثم إعادة المحاولة.';
    } else if (code === 'auth/popup-blocked') {
      error.friendlyMessage = 'تم حظر النافذة المنبثقة بواسطة المتصفح. يرجى السماح بالنوافذ المنبثقة للموقع أو فتح التطبيق في نافذة مستقلة.';
    } else if (code === 'auth/popup-closed-by-user') {
      error.friendlyMessage = 'تم إغلاق نافذة تسجيل الدخول قبل استكمال المصادقة.';
    } else if (code === 'auth/cancelled-popup-request') {
      error.friendlyMessage = 'تم إلغاء طلب تسجيل الدخول لوجود عملية مصادقة أخرى قيد التنفيذ.';
    } else if (code === 'auth/account-exists-with-different-credential') {
      error.friendlyMessage = 'هذا البريد الإلكتروني مسجل مسبقاً بوسيلة دخول أخرى (مثل كلمة المرور). يرجى تسجيل الدخول بالبريد أولاً.';
    } else if (code === 'auth/internal-error') {
      error.friendlyMessage = 'حدث خطأ داخلي في مزود Google. تأكد من تفعيل Google في Firebase Console واختيار بريد دعم المشروع.';
    } else if (code === 'auth/configuration-not-found') {
      error.friendlyMessage = 'إعدادات مزود Google غير مكتملة في مشروع Firebase. يرجى تفعيل مزود Google في Firebase Console.';
    } else {
      error.friendlyMessage = error.friendlyMessage || `تعذر إكمال تسجيل الدخول بحساب Google (${code}). يمكنك الدخول بالبريد ثم إعادة المحاولة.`;
    }
    throw error;
  }
};

export const signInWithGoogleRedirect = async () => {
  return signInWithRedirect(auth, googleProvider);
};

export const checkRedirectResult = async () => {
  try {
    const result = await getRedirectResult(auth);
    return result?.user || null;
  } catch (err: any) {
    console.warn('Redirect sign-in notice:', err?.code);
    return null;
  }
};

export const loginWithEmail = async (identifier: string, password: string) => {
  const email = normalizeLoginIdentifier(identifier);
  if (!email.includes('@')) {
    const error: any = new Error('email_required');
    error.code = 'auth/email-required';
    error.friendlyMessage = 'أدخل بريدك الإلكتروني المسجل.';
    throw error;
  }
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    if (!user.emailVerified) {
      if (user.email) {
        try {
          await sendVerification(user);
        } catch {
          // A resend can be rate-limited; the original verification link remains valid.
        }
      }
      await signOut(auth);
      const verificationError: any = new Error('email_not_verified');
      verificationError.code = 'auth/email-not-verified';
      verificationError.friendlyMessage = 'البريد الإلكتروني غير مؤكد. أرسلنا رابط تحقق جديداً إن أمكن؛ افتح بريدك واضغط الرابط ثم سجّل الدخول.';
      throw verificationError;
    }
    return user;
  } catch (error: any) {
    const code = error?.code || 'unknown';
    console.warn('Email sign-in notice:', code);
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      error.friendlyMessage = 'بيانات الدخول غير صحيحة. يرجى التحقق من المعرف أو كلمة المرور، أو الضغط على إنشاء حساب جديد.';
    } else if (code === 'auth/network-request-failed') {
      error.friendlyMessage = 'تعذر الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت ثم إعادة المحاولة.';
    }
    throw error;
  }
};

const sendVerification = async (user: User) => {
  try {
    await sendEmailVerification(user, { url: window.location.origin, handleCodeInApp: false });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== 'auth/unauthorized-continue-uri' && code !== 'auth/invalid-continue-uri') throw error;
    // Firebase's default action page still works if the deployment URL is not allowlisted.
    await sendEmailVerification(user);
  }
};

export const registerMerchant = async (
  identifier: string,
  password: string,
  displayName: string
) => {
  const rawEmail = identifier.trim().toLowerCase();
  if (!rawEmail.includes('@')) {
    const error: any = new Error('email_required');
    error.code = 'auth/email-required';
    error.friendlyMessage = 'إنشاء حساب جديد يتطلب بريداً إلكترونياً حقيقياً حتى نرسل رابط التحقق.';
    throw error;
  }
  const email = normalizeLoginIdentifier(rawEmail);
  let accountCreated = false;
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    accountCreated = true;
    try {
      await sendVerification(userCredential.user);
      if (displayName) {
        try { await updateProfile(userCredential.user, { displayName }); }
        catch { console.warn('Merchant display name was not saved; email verification was sent.'); }
      }
    } finally {
      // Even a delivery/profile failure must not leave an unverified account signed in.
      await signOut(auth);
    }
    return userCredential.user;
  } catch (error: any) {
    const code = error?.code || 'unknown';
    console.warn('Merchant registration notice:', code);
    if (code === 'auth/email-already-in-use') {
      error.friendlyMessage = 'هذا الحساب مسجل بالفعل. يرجى تسجيل الدخول بدلاً من التسجيل.';
    } else if (code === 'auth/weak-password') {
      error.friendlyMessage = 'كلمة المرور ضعيفة جداً. يرجى إدخال 6 أحرف أو أرقام على الأقل.';
    } else if (accountCreated) {
      error.friendlyMessage = 'تم إنشاء الحساب، لكن تعذر إكمال إرسال رابط التحقق. حاول تسجيل الدخول لإعادة إرسال الرابط؛ لن يُسمح بالدخول قبل تأكيد البريد.';
    } else if (code === 'auth/too-many-requests') {
      error.friendlyMessage = 'تم إرسال محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.';
    }
    throw error;
  }
};

export const requestPasswordReset = async (identifier: string) => {
  const trimmed = identifier.trim();
  if (!trimmed.includes('@')) {
    throw new Error('لاسترجاع كلمة المرور يرجى إدخال بريدك الإلكتروني المسجل في النظام.');
  }
  try {
    await sendPasswordResetEmail(auth, trimmed);
  } catch (error: any) {
    console.error('Error sending password reset email:', error);
    throw error;
  }
};

export const logout = async () => {
  try {
    await signOut(auth);
  } catch (error: any) {
    console.error('Error signing out:', error);
    throw error;
  }
};

export { onAuthStateChanged };
export type { User };
