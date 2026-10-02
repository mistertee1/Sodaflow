import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
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
    // Attach user-friendly descriptive message
    if (code === 'auth/network-request-failed') {
      error.friendlyMessage = 'تعذر الاتصال بخدمة Google عبر النافذة المنبثقة داخل إطار المعاينة (بسبب قيود المتصفح لملفات تعريف الارتباط للطرف الثالث). يمكنك فتح التطبيق في نافذة مستقلة، أو تسجيل الدخول بالبريد الإلكتروني، أو المتابعة كضيف.';
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
      error.friendlyMessage = 'تعذر الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت أو المتابعة كضيف.';
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

