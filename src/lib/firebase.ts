import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
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

// Convert phone number or email to valid Firebase email string
export function normalizeLoginIdentifier(identifier: string): string {
  const trimmed = identifier.trim().toLowerCase();
  if (trimmed.includes('@')) {
    return trimmed;
  }
  // If it's a phone number (Sudanese phone e.g. 0912345678 or +249...)
  const cleanDigits = trimmed.replace(/\D/g, '');
  return `${cleanDigits}@mohasbasd.app`;
}

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error: any) {
    const code = error?.code || 'unknown';
    console.warn('Google sign-in popup notice:', code, error?.message);
    // Attach user-friendly descriptive message
    if (code === 'auth/network-request-failed') {
      error.friendlyMessage = 'تعذر الاتصال بخدمة Google عبر النافذة المنبثقة داخل إطار المعاينة (بسبب قيود المتصفح لملفات تعريف الارتباط للطرف الثالث). يمكنك فتح التطبيق في نافذة مستقلة، أو تسجيل الدخول بالبريد/رقم الهاتف، أو المتابعة كضيف.';
    } else if (code === 'auth/popup-blocked') {
      error.friendlyMessage = 'تم حظر النافذة المنبثقة بواسطة المتصفح. يرجى السماح بالنوافذ المنبثقة ثم المحاولة مجدداً.';
    } else if (code === 'auth/popup-closed-by-user') {
      error.friendlyMessage = 'تم إغلاق نافذة تسجيل الدخول قبل استكمال المصادقة.';
    } else if (code === 'auth/cancelled-popup-request') {
      error.friendlyMessage = 'تم إلغاء طلب تسجيل الدخول لوجود عملية أخرى قيد التنفيذ.';
    }
    throw error;
  }
};

export const loginWithEmailOrPhone = async (identifier: string, password: string) => {
  const email = normalizeLoginIdentifier(identifier);
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return userCredential.user;
  } catch (error: any) {
    const code = error?.code || 'unknown';
    console.warn('Email/phone sign-in notice:', code);
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      error.friendlyMessage = 'بيانات الدخول غير صحيحة. يرجى التحقق من المعرف أو كلمة المرور، أو الضغط على إنشاء حساب جديد.';
    } else if (code === 'auth/network-request-failed') {
      error.friendlyMessage = 'تعذر الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت أو المتابعة كضيف.';
    }
    throw error;
  }
};

export const registerMerchant = async (
  identifier: string,
  password: string,
  displayName: string
) => {
  const email = normalizeLoginIdentifier(identifier);
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) {
      await updateProfile(userCredential.user, { displayName });
    }
    return userCredential.user;
  } catch (error: any) {
    const code = error?.code || 'unknown';
    console.warn('Merchant registration notice:', code);
    if (code === 'auth/email-already-in-use') {
      error.friendlyMessage = 'هذا الحساب مسجل بالفعل. يرجى تسجيل الدخول بدلاً من التسجيل.';
    } else if (code === 'auth/weak-password') {
      error.friendlyMessage = 'كلمة المرور ضعيفة جداً. يرجى إدخال 6 أحرف أو أرقام على الأقل.';
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

