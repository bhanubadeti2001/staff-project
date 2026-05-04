/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, Component } from 'react';
import { 
  LayoutDashboard, 
  Clock, 
  BarChart3, 
  Users, 
  LogOut, 
  LogIn, 
  Coffee, 
  Timer, 
  UserPlus, 
  Trash2, 
  Download, 
  Edit, 
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  QrCode,
  Calendar as CalendarIcon,
  Search,
  ShieldCheck
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell 
} from 'recharts';
import { QRCodeSVG } from 'qrcode.react';

// --- Firebase Imports ---
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  onSnapshot, 
  query, 
  where, 
  updateDoc, 
  deleteDoc,
  Timestamp,
  getDocFromServer,
  terminate,
  clearIndexedDbPersistence
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult
} from 'firebase/auth';
import { db, auth } from './firebase';

// --- Constants & Config ---
const ROLES = {
  ADMIN: 'admin',
  VIEWER: 'viewer'
};

const ATTENDANCE_STATUS = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  WEEK_OFF: 'Week Off'
};

// --- Types ---
interface Staff {
  id: string;
  name: string;
  role: string;
  shift_start: string;
  shift_end: string;
  week_off: string;
}

interface Attendance {
  date: string;
  staff_id: string;
  check_in: string | null;
  break_start: string | null;
  break_end: string | null;
  check_out: string | null;
  status: string;
  notes: string | null;
}


// --- Error Handling & Helpers ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends Component<any, any> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-cream">
          <div className="max-w-md w-full glass-card p-8 rounded-2xl shadow-xl text-center">
            <AlertCircle className="text-red-500 mx-auto mb-4" size={48} />
            <h2 className="text-2xl font-bold text-espresso mb-2">Something went wrong</h2>
            <p className="text-latte mb-6">The application encountered an error. Please try refreshing the page.</p>
            <div className="bg-red-50 p-4 rounded-lg text-left mb-6 overflow-auto max-h-40">
              <code className="text-xs text-red-700">{this.state.errorInfo}</code>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-espresso text-cream py-3 rounded-xl font-bold hover:bg-espresso/90 transition-all"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Main App Component ---
export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<{ uid: string, email: string, role: string } | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [allAttendance, setAllAttendance] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [error, setError] = useState('');
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [showOtp, setShowOtp] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [loginMethod, setLoginMethod] = useState<'google' | 'phone'>('google');

  // Monitor online status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Clear recaptcha on method change
  useEffect(() => {
    if ((window as any).recaptchaVerifier) {
      try {
        (window as any).recaptchaVerifier.clear();
        (window as any).recaptchaVerifier = null;
      } catch (e) {
        console.error("Error clearing recaptcha:", e);
      }
    }
    setError(null);
  }, [loginMethod]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data() as { role: string, email: string, uid: string };
            setUser(userData);
          } else {
            // Default to viewer for new users, unless they are the default admin
            const role = (firebaseUser.email === "bhanunani886@gmail.com" || firebaseUser.phoneNumber === "bhanunani886@gmail.com") ? ROLES.ADMIN : ROLES.VIEWER;
            const newUser = {
              uid: firebaseUser.uid,
              email: firebaseUser.email || firebaseUser.phoneNumber || 'unknown',
              role: role
            };
            await setDoc(doc(db, 'users', firebaseUser.uid), newUser);
            setUser(newUser);
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
          setError("Failed to load user profile");
        }
      } else {
        setUser(null);
      }
      setIsAuthReady(true);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const setupRecaptcha = () => {
    try {
      if ((window as any).recaptchaVerifier) {
        (window as any).recaptchaVerifier.clear();
        (window as any).recaptchaVerifier = null;
      }
      (window as any).recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        'size': 'invisible',
        'callback': () => {
          console.log('Recaptcha resolved');
        }
      });
    } catch (err) {
      console.error("Recaptcha setup error:", err);
    }
  };

  const handlePhoneLogin = async () => {
    if (!phone) return;
    setLoading(true);
    setError(null);
    try {
      setupRecaptcha();
      const appVerifier = (window as any).recaptchaVerifier;
      const confirmation = await signInWithPhoneNumber(auth, phone, appVerifier);
      setConfirmationResult(confirmation);
      setShowOtp(true);
    } catch (err: any) {
      console.error("Phone login error:", err);
      setError(err.message || "Failed to send OTP");
      if ((window as any).recaptchaVerifier) {
        (window as any).recaptchaVerifier.clear();
        (window as any).recaptchaVerifier = null;
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp || !confirmationResult) return;
    setLoading(true);
    setError(null);
    try {
      await confirmationResult.confirm(otp);
      setShowOtp(false);
      setOtp('');
      setPhone('');
    } catch (err: any) {
      console.error("OTP verification error:", err);
      setError(err.message || "Invalid OTP");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const [checkInSuccess, setCheckInSuccess] = useState<string | null>(null);

  // Today's date string YYYY-MM-DD
  const today = currentTime.toISOString().split('T')[0];

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Real-time Staff Listener
  useEffect(() => {
    if (!isAuthReady || !user) return;

    const unsubscribe = onSnapshot(collection(db, 'staff'), (snapshot) => {
      const staffList = snapshot.docs.map(doc => doc.data() as Staff);
      setStaff(staffList);
      
      // Seed initial data if empty and admin
      if (staffList.length === 0 && user.role === ROLES.ADMIN) {
        seedInitialStaff();
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'staff');
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  // Real-time Today's Attendance Listener
  useEffect(() => {
    if (!isAuthReady || !user) return;

    const q = query(collection(db, 'attendance'), where('date', '==', today));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setAttendance(snapshot.docs.map(doc => doc.data() as Attendance));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'attendance');
    });

    return () => unsubscribe();
  }, [isAuthReady, user, today]);

  // Real-time All Attendance Listener (for reports) - Only active when on reports tab
  useEffect(() => {
    if (!isAuthReady || !user || (activeTab !== 'reports' && activeTab !== 'viewer-overview')) return;

    const unsubscribe = onSnapshot(collection(db, 'attendance'), (snapshot) => {
      setAllAttendance(snapshot.docs.map(doc => doc.data() as Attendance));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'attendance');
    });

    return () => unsubscribe();
  }, [isAuthReady, user, activeTab]);

  const seedInitialStaff = async () => {
    const initialStaff: Staff[] = [
      { id: 'TI001', name: 'Ved', role: 'FDM', shift_start: '11:00', shift_end: '19:00', week_off: 'Sunday' },
      { id: 'TI002', name: 'Jean', role: 'FDM', shift_start: '19:00', shift_end: '00:00', week_off: 'Saturday' },
      { id: 'TI003', name: 'Dinesh', role: 'FDM', shift_start: '19:00', shift_end: '00:00', week_off: 'Friday' },
      { id: 'TI004', name: 'Manish Kumar', role: 'Chef', shift_start: '09:00', shift_end: '18:00', week_off: 'Sunday' },
      { id: 'TI005', name: 'Bableau', role: 'Cafe Helper', shift_start: '09:00', shift_end: '18:00', week_off: 'Sunday' },
      { id: 'TI006', name: 'Arun', role: 'Barista', shift_start: '09:00', shift_end: '18:00', week_off: 'Sunday' },
      { id: 'TI007', name: 'Eilya', role: 'House Keeping', shift_start: '08:00', shift_end: '21:00', week_off: 'No weekoff' },
    ];
    
    for (const s of initialStaff) {
      await setDoc(doc(db, 'staff', s.id), s);
    }
  };

  // Handle QR Auto Check-in
  useEffect(() => {
    if (!isAuthReady || !user) return;
    
    const params = new URLSearchParams(window.location.search);
    const staffId = params.get('staffId');
    const auto = params.get('auto');

    if (staffId && auto === 'true') {
      const handleAutoCheckIn = async () => {
        setLoading(true);
        try {
          const staffDoc = await getDoc(doc(db, 'staff', staffId));
          if (staffDoc.exists()) {
            const member = staffDoc.data() as Staff;
            const attendanceQuery = query(collection(db, 'attendance'), where('date', '==', today), where('staff_id', '==', staffId));
            const attendanceSnap = await getDocs(attendanceQuery);
            const record = attendanceSnap.docs[0]?.data() as Attendance | undefined;
            
            const timeStr = new Date().toTimeString().split(' ')[0].substring(0, 5);
            
            if (!record) {
              const shiftStart = member.shift_start;
              const [h, m] = shiftStart.split(':').map(Number);
              const [nowH, nowM] = timeStr.split(':').map(Number);
              const diffMinutes = (nowH * 60 + nowM) - (h * 60 + m);
              const status = diffMinutes > 15 ? ATTENDANCE_STATUS.LATE : ATTENDANCE_STATUS.PRESENT;

              const newRecord: Attendance = {
                date: today, staff_id: member.id, check_in: timeStr,
                break_start: null, break_end: null, check_out: null,
                status: status, notes: diffMinutes > 15 ? `Late by ${diffMinutes} mins` : null
              };

              await setDoc(doc(db, 'attendance', `${today}_${member.id}`), newRecord);
              setCheckInSuccess(`${member.name} checked in at ${timeStr}`);
            } else if (record.check_in && !record.check_out) {
              await updateDoc(doc(db, 'attendance', `${today}_${member.id}`), { check_out: timeStr });
              setCheckInSuccess(`${member.name} checked out at ${timeStr}`);
            } else {
              setCheckInSuccess('Shift already completed for today.');
            }
          } else {
            alert('Staff member not found');
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, 'attendance');
        } finally {
          setLoading(false);
        }
      };
      handleAutoCheckIn();
    }
  }, [isAuthReady, user, today]);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to sign in with Google');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await signOut(auth);
      setUser(null);
      setActiveTab('dashboard');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckInAction = async (member: Staff, record?: Attendance) => {
    const timeStr = currentTime.toTimeString().split(' ')[0].substring(0, 5);
    setLoading(true);
    
    try {
      if (!record) {
        const shiftStart = member.shift_start;
        const [h, m] = shiftStart.split(':').map(Number);
        const [nowH, nowM] = timeStr.split(':').map(Number);
        const diffMinutes = (nowH * 60 + nowM) - (h * 60 + m);
        const status = diffMinutes > 15 ? ATTENDANCE_STATUS.LATE : ATTENDANCE_STATUS.PRESENT;

        const newRecord: Attendance = {
          date: today, staff_id: member.id, check_in: timeStr,
          break_start: null, break_end: null, check_out: null,
          status: status, notes: diffMinutes > 15 ? `Late by ${diffMinutes} mins` : null
        };

        await setDoc(doc(db, 'attendance', `${today}_${member.id}`), newRecord);
        alert(`${member.name} checked in at ${timeStr}`);
      } else if (record.check_in && !record.break_start && !record.check_out) {
        await updateDoc(doc(db, 'attendance', `${today}_${member.id}`), { break_start: timeStr });
        alert(`${member.name} started break at ${timeStr}`);
      } else if (record.break_start && !record.break_end && !record.check_out) {
        await updateDoc(doc(db, 'attendance', `${today}_${member.id}`), { break_end: timeStr });
        alert(`${member.name} ended break at ${timeStr}`);
      } else if (record.check_in && !record.check_out) {
        await updateDoc(doc(db, 'attendance', `${today}_${member.id}`), { check_out: timeStr });
        alert(`${member.name} checked out at ${timeStr}`);
      } else {
        alert('Shift already completed for today.');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'attendance');
    } finally {
      setLoading(false);
    }
  };

  const isShiftTurn = (staffId: string) => {
    if (staffId !== 'TI002' && staffId !== 'TI003') return true;
    const dayOfYear = Math.floor((currentTime.getTime() - new Date(currentTime.getFullYear(), 0, 0).getTime()) / 86400000);
    const isEvenDay = dayOfYear % 2 === 0;
    return staffId === 'TI002' ? isEvenDay : !isEvenDay;
  };

  // --- Render Helpers ---
  if (checkInSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-cream">
        <div className="w-full max-w-md glass-card rounded-3xl shadow-2xl p-12 text-center space-y-6 animate-in zoom-in-95 duration-300">
          <div className="w-24 h-24 bg-ivy/10 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="text-ivy" size={48} />
          </div>
          <h2 className="text-3xl font-bold text-espresso">Success!</h2>
          <p className="text-xl text-latte">{checkInSuccess}</p>
          <button 
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.delete('staffId');
              url.searchParams.delete('auto');
              window.history.replaceState({}, '', url);
              setCheckInSuccess(null);
            }}
            className="w-full bg-espresso text-cream py-4 rounded-xl font-bold hover:bg-espresso/90 transition-all"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md glass-card rounded-2xl shadow-2xl overflow-hidden">
          <div className="bg-espresso p-8 text-center">
            <h1 className="text-cream text-3xl font-bold mb-2">Trailing Ivy Café</h1>
            <p className="text-latte italic">Staff Attendance System</p>
          </div>
          <div className="p-8">
            <div className="text-center mb-8">
              <ShieldCheck className="mx-auto text-caramel mb-4" size={48} />
              <h2 className="text-2xl font-bold text-espresso">Secure Access</h2>
              <p className="text-latte">Choose your preferred login method.</p>
            </div>

            <div className="flex gap-2 mb-6">
              <button 
                onClick={() => setLoginMethod('google')}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${loginMethod === 'google' ? 'bg-espresso text-cream' : 'bg-cream text-espresso border border-latte/20'}`}
              >
                Google
              </button>
              <button 
                onClick={() => setLoginMethod('phone')}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${loginMethod === 'phone' ? 'bg-espresso text-cream' : 'bg-cream text-espresso border border-latte/20'}`}
              >
                Phone
              </button>
            </div>
            
            {loginMethod === 'google' ? (
              <button 
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full bg-white border-2 border-latte/20 text-espresso py-3 rounded-lg font-bold hover:bg-cream transition-all flex items-center justify-center gap-3 shadow-sm"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
                Sign in with Google
              </button>
            ) : (
              <div className="space-y-4">
                {!showOtp ? (
                  <>
                    <input 
                      type="tel" 
                      placeholder="+1234567890" 
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full p-3 rounded-lg border-2 border-latte/20 focus:border-caramel outline-none"
                    />
                    <button 
                      onClick={handlePhoneLogin}
                      disabled={loading || !phone}
                      className="w-full bg-espresso text-cream py-3 rounded-lg font-bold hover:bg-espresso/90 transition-all"
                    >
                      Send Verification Code
                    </button>
                  </>
                ) : (
                  <>
                    <input 
                      type="text" 
                      placeholder="Enter 6-digit OTP" 
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      className="w-full p-3 rounded-lg border-2 border-latte/20 focus:border-caramel outline-none text-center tracking-widest font-bold"
                    />
                    <button 
                      onClick={handleVerifyOtp}
                      disabled={loading || !otp}
                      className="w-full bg-ivy text-white py-3 rounded-lg font-bold hover:bg-ivy/90 transition-all"
                    >
                      Verify & Login
                    </button>
                    <button 
                      onClick={() => setShowOtp(false)}
                      className="w-full text-xs text-latte hover:text-espresso underline"
                    >
                      Change Phone Number
                    </button>
                  </>
                )}
                <div id="recaptcha-container"></div>
              </div>
            )}

            {error && <p className="mt-4 text-red-500 text-sm text-center">{error}</p>}

            <div className="mt-8 pt-6 border-t border-latte/20">
              <h4 className="text-sm font-bold text-espresso mb-3 flex items-center gap-2">
                <QrCode size={16} className="text-caramel" /> Mobile Installation
              </h4>
              <p className="text-xs text-latte leading-relaxed">
                To use this as a full-screen app on your phone:
                <br />
                1. Open the <strong>Shared App URL</strong> in Safari (iPhone) or Chrome (Android).
                <br />
                2. Tap <strong>Share</strong> (iPhone) or <strong>Menu</strong> (Android).
                <br />
                3. Select <strong>"Add to Home Screen"</strong>.
              </p>
              {deferredPrompt && (
                <button 
                  onClick={handleInstallClick}
                  className="mt-4 w-full bg-caramel text-white py-2 rounded-lg text-sm font-bold shadow-md hover:bg-caramel/90 transition-all flex items-center justify-center gap-2"
                >
                  <Download size={16} /> Install App Now
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-red-600 text-white text-[10px] font-bold py-1 px-4 text-center uppercase tracking-widest animate-pulse">
          Offline Mode - Data will sync when reconnected
        </div>
      )}
      
      {/* Navbar */}
      <nav className="bg-espresso text-cream sticky top-0 z-50 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Coffee className="text-caramel" />
            <span className="text-xl font-bold tracking-tight">Trailing Ivy Café</span>
          </div>
          <div className="hidden md:flex items-center gap-6">
            {user?.role === ROLES.ADMIN ? (
              <>
                <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard size={18}/>} label="Dashboard" />
                <NavButton active={activeTab === 'terminal'} onClick={() => setActiveTab('terminal')} icon={<Clock size={18}/>} label="Terminal" />
                <NavButton active={activeTab === 'reports'} onClick={() => setActiveTab('reports')} icon={<BarChart3 size={18}/>} label="Reports" />
                <NavButton active={activeTab === 'staff'} onClick={() => setActiveTab('staff')} icon={<Users size={18}/>} label="Staff" />
              </>
            ) : (
              <NavButton active={activeTab === 'viewer-overview'} onClick={() => setActiveTab('viewer-overview')} icon={<LayoutDashboard size={18}/>} label="Overview" />
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-xs font-bold text-caramel uppercase">{user.role}</span>
              <span className="text-[10px] text-latte">{user.email}</span>
            </div>
            <button 
              onClick={handleLogout}
              className="flex items-center gap-2 text-latte hover:text-cream transition-colors"
            >
              <LogOut size={18} /> <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8">
        {activeTab === 'dashboard' && <AdminDashboard staff={staff} attendance={attendance} />}
        {activeTab === 'terminal' && <CheckInTerminal staff={staff} attendance={attendance} onAction={handleCheckInAction} currentTime={currentTime} isShiftTurn={isShiftTurn} />}
        {activeTab === 'reports' && <MonthlyReports staff={staff} allAttendance={allAttendance} />}
        {activeTab === 'staff' && <StaffManagement staff={staff} />}
        {activeTab === 'viewer-overview' && <ViewerOverview staff={staff} allAttendance={allAttendance} />}
      </main>

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 z-[100] loading-overlay flex flex-col items-center justify-center text-cream">
          <div className="spinner mb-4"></div>
          <p className="font-medium animate-pulse">Processing...</p>
        </div>
      )}
    </div>
  );
}

// --- Sub-Components ---

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${active ? 'bg-caramel text-white' : 'text-latte hover:text-cream'}`}
    >
      {icon} <span>{label}</span>
    </button>
  );
}

function AdminDashboard({ staff, attendance }: { staff: Staff[], attendance: Attendance[] }) {
  const stats = useMemo(() => {
    const present = attendance.filter(a => a.status === ATTENDANCE_STATUS.PRESENT || a.status === ATTENDANCE_STATUS.LATE).length;
    const late = attendance.filter(a => a.status === ATTENDANCE_STATUS.LATE).length;
    const absent = staff.length - attendance.length;
    const onBreak = attendance.filter(a => a.break_start && !a.break_end).length;
    const completed = attendance.filter(a => a.check_out).length;
    
    return { present, late, absent, onBreak, completed };
  }, [staff, attendance]);

  const progressPercentage = staff.length > 0 ? Math.round((stats.present / staff.length) * 100) : 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-3xl font-bold text-espresso tracking-tight">Daily Dashboard</h2>
            <span className="px-2 py-1 bg-ivy/10 text-ivy text-[10px] font-bold rounded-full uppercase tracking-widest border border-ivy/20">Live</span>
          </div>
          <p className="text-latte font-medium">Overview for {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-white border border-latte/20 text-espresso px-4 py-2 rounded-lg hover:bg-cream transition-all shadow-sm"
          >
            <Download size={18} className="rotate-180" /> Print Daily Log
          </button>
          <button 
            onClick={() => {
              const csv = [
                ['Name', 'Check-In', 'Break Start', 'Break End', 'Check-Out', 'Status'],
                ...attendance.map(a => {
                  const s = staff.find(st => st.id === a.staff_id);
                  return [s?.name || 'Unknown', a.check_in, a.break_start, a.break_end, a.check_out, a.status];
                })
              ].map(e => e.join(",")).join("\n");
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.setAttribute('hidden', '');
              a.setAttribute('href', url);
              a.setAttribute('download', `attendance_${new Date().toISOString().split('T')[0]}.csv`);
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }}
            className="flex items-center gap-2 bg-ivy text-white px-4 py-2 rounded-lg hover:bg-ivy/90 transition-all shadow-md"
          >
            <Download size={18} /> Export CSV
          </button>
        </div>
      </div>

      {/* Daily Progress Card */}
      <div className="glass-card p-6 rounded-3xl shadow-xl border-l-8 border-caramel">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex-1 space-y-2">
            <div className="flex justify-between items-end">
              <h3 className="text-lg font-bold text-espresso">Daily Attendance Progress</h3>
              <span className="text-sm font-bold text-caramel">{progressPercentage}% Complete</span>
            </div>
            <div className="w-full bg-cream rounded-full h-3 overflow-hidden border border-latte/10">
              <div 
                className="bg-caramel h-full transition-all duration-1000 ease-out" 
                style={{ width: `${progressPercentage}%` }}
              ></div>
            </div>
            <p className="text-xs text-latte italic">
              {stats.present} out of {staff.length} staff members have checked in so far today.
            </p>
          </div>
          <div className="flex gap-4">
            <div className="text-center px-6 py-2 bg-cream rounded-2xl border border-latte/10">
              <p className="text-[10px] font-bold text-latte uppercase tracking-widest">Completed</p>
              <p className="text-2xl font-black text-espresso">{stats.completed}</p>
            </div>
            <div className="text-center px-6 py-2 bg-cream rounded-2xl border border-latte/10">
              <p className="text-[10px] font-bold text-latte uppercase tracking-widest">Active Now</p>
              <p className="text-2xl font-black text-ivy">{stats.present - stats.completed}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label="Present" value={stats.present} color="border-ivy" icon={<CheckCircle2 className="text-ivy" />} />
        <StatCard label="Late" value={stats.late} color="border-caramel" icon={<AlertCircle className="text-caramel" />} />
        <StatCard label="Absent" value={stats.absent} color="border-red-500" icon={<XCircle className="text-red-500" />} />
        <StatCard label="On Break" value={stats.onBreak} color="border-latte" icon={<Timer className="text-latte" />} />
      </div>

      {/* Log Table */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2 glass-card rounded-2xl overflow-hidden shadow-xl">
          <div className="foam-header p-6 border-b border-latte/20 flex justify-between items-center">
            <h3 className="text-xl font-bold flex items-center gap-2">
              <LayoutDashboard className="text-caramel" size={20} /> Today's Log
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-cream/50 text-espresso/60 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4">Staff</th>
                  <th className="px-6 py-4">Check-In</th>
                  <th className="px-6 py-4">Break</th>
                  <th className="px-6 py-4">Check-Out</th>
                  <th className="px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-latte/10">
                {attendance.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-latte italic">
                      No attendance records for today yet.
                    </td>
                  </tr>
                ) : (
                  attendance.map(record => {
                    const member = staff.find(s => s.id === record.staff_id);
                    return (
                      <tr key={record.staff_id} className="hover:bg-cream/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-bold text-espresso">{member?.name || 'Unknown'}</div>
                          <div className="text-xs text-latte">{member?.role}</div>
                        </td>
                        <td className="px-6 py-4 time-display">{record.check_in || '--:--'}</td>
                        <td className="px-6 py-4 time-display">
                          {record.break_start ? `${record.break_start} - ${record.break_end || '...'}` : '--:--'}
                        </td>
                        <td className="px-6 py-4 time-display">{record.check_out || '--:--'}</td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                            record.status === ATTENDANCE_STATUS.PRESENT ? 'bg-ivy/10 text-ivy' :
                            record.status === ATTENDANCE_STATUS.LATE ? 'bg-caramel/10 text-caramel' :
                            'bg-red-100 text-red-600'
                          }`}>
                            {record.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Missing Staff Sidebar */}
        <div className="glass-card rounded-2xl overflow-hidden shadow-xl flex flex-col">
          <div className="bg-red-500 p-6 text-white">
            <h3 className="text-xl font-bold flex items-center gap-2">
              <AlertCircle size={20} /> Not Checked In
            </h3>
            <p className="text-xs opacity-80 mt-1">Staff members who haven't arrived yet today.</p>
          </div>
          <div className="flex-1 p-6 space-y-4 overflow-y-auto max-h-[600px]">
            {staff.filter(s => !attendance.some(a => a.staff_id === s.id)).length === 0 ? (
              <div className="text-center py-12 space-y-3">
                <CheckCircle2 size={48} className="text-ivy mx-auto opacity-20" />
                <p className="text-latte italic">All staff have checked in!</p>
              </div>
            ) : (
              staff.filter(s => !attendance.some(a => a.staff_id === s.id)).map(member => (
                <div key={member.id} className="flex items-center justify-between p-4 bg-cream rounded-xl border border-latte/10">
                  <div>
                    <p className="font-bold text-espresso">{member.name}</p>
                    <p className="text-xs text-latte">Shift: {member.shift_start} - {member.shift_end}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-1 rounded uppercase">Missing</span>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="p-4 bg-cream/50 border-t border-latte/10">
            <p className="text-[10px] text-latte text-center">
              Total Staff: {staff.length} | Missing: {staff.filter(s => !attendance.some(a => a.staff_id === s.id)).length}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string, value: number, color: string, icon: React.ReactNode }) {
  return (
    <div className={`glass-card p-6 rounded-2xl border-t-4 ${color} shadow-lg flex items-center justify-between`}>
      <div>
        <p className="text-latte text-sm font-medium uppercase tracking-wider">{label}</p>
        <p className="text-3xl font-bold text-espresso mt-1">{value}</p>
      </div>
      <div className="p-3 bg-cream rounded-xl">
        {icon}
      </div>
    </div>
  );
}

function CheckInTerminal({ staff, attendance, onAction, currentTime, isShiftTurn }: { staff: Staff[], attendance: Attendance[], onAction: (m: Staff, r?: Attendance) => void, currentTime: Date, isShiftTurn: (id: string) => boolean }) {
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [staffIdInput, setStaffIdInput] = useState('');
  
  const currentMember = staff.find(s => s.id === selectedStaff || s.id === staffIdInput.toUpperCase());
  const currentRecord = attendance.find(a => a.staff_id === currentMember?.id);

  const onDuty = staff.filter(s => attendance.some(a => a.staff_id === s.id && !a.check_out));
  const offDuty = staff.filter(s => !attendance.some(a => a.staff_id === s.id) || attendance.some(a => a.staff_id === s.id && a.check_out));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in slide-in-from-bottom-4 duration-500">
      {/* Left: Terminal Control */}
      <div className="lg:col-span-2 space-y-8">
        <div className="glass-card p-8 rounded-3xl shadow-2xl text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-espresso"></div>
          <h2 className="text-4xl font-black text-espresso mb-2 tracking-tight">
            {currentTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </h2>
          <p className="text-latte font-medium mb-8 uppercase tracking-widest">
            {currentTime.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>

          <div className="max-w-md mx-auto space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
              <div>
                <label className="block text-sm font-bold text-espresso mb-2">Select Staff Member</label>
                <select 
                  value={selectedStaff}
                  onChange={e => {
                    setSelectedStaff(e.target.value);
                    setStaffIdInput('');
                  }}
                  className="w-full p-4 rounded-xl border-2 border-latte/20 focus:border-caramel focus:outline-none bg-cream/50 text-lg font-medium"
                >
                  <option value="">-- Choose Name --</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-espresso mb-2">Or Enter Staff ID</label>
                <input 
                  type="text"
                  placeholder="e.g. TI001"
                  value={staffIdInput}
                  onChange={e => {
                    setStaffIdInput(e.target.value);
                    setSelectedStaff('');
                  }}
                  className="w-full p-4 rounded-xl border-2 border-latte/20 focus:border-caramel focus:outline-none bg-cream/50 text-lg font-medium uppercase"
                />
              </div>
            </div>

            {currentMember && (
              <div className="bg-cream/50 p-6 rounded-2xl border border-latte/20 animate-in zoom-in-95 duration-300">
                {!isShiftTurn(currentMember.id) && (
                  <div className="mb-4 p-3 bg-caramel/10 text-caramel rounded-lg flex items-center gap-2 text-sm font-bold">
                    <AlertCircle size={16} /> Note: It's not your scheduled shift today.
                  </div>
                )}
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-16 h-16 bg-espresso rounded-full flex items-center justify-center text-cream text-2xl font-bold">
                    {currentMember.name[0]}
                  </div>
                  <div className="text-left">
                    <h3 className="text-xl font-bold">{currentMember.name}</h3>
                    <p className="text-latte text-sm">{currentMember.role} • {currentMember.shift_start}-{currentMember.shift_end}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <ActionButton 
                    onClick={() => onAction(currentMember, currentRecord)}
                    disabled={!!currentRecord?.check_in && !!currentRecord?.check_out}
                    icon={!currentRecord ? <LogIn /> : currentRecord.break_start && !currentRecord.break_end ? <Timer /> : currentRecord.check_in && !currentRecord.check_out ? <Coffee /> : <CheckCircle2 />}
                    label={!currentRecord ? 'Check In' : currentRecord.break_start && !currentRecord.break_end ? 'End Break' : currentRecord.check_in && !currentRecord.check_out ? 'Start Break' : 'Completed'}
                    color={!currentRecord ? 'bg-ivy' : 'bg-caramel'}
                  />
                  <ActionButton 
                    onClick={() => onAction(currentMember, currentRecord)}
                    disabled={!currentRecord?.check_in || !!currentRecord?.check_out}
                    icon={<LogOut />}
                    label="Check Out"
                    color="bg-espresso"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* QR Section */}
        <div className="glass-card p-8 rounded-3xl shadow-xl flex flex-col md:flex-row items-center gap-8">
          <div className="bg-white p-4 rounded-2xl shadow-inner">
            <QRCodeSVG 
              value={`${window.location.origin}${window.location.pathname}?staffId=${selectedStaff || 'TI001'}&auto=true`} 
              size={180}
              fgColor="#2C1810"
            />
          </div>
          <div className="text-center md:text-left">
            <h3 className="text-2xl font-bold text-espresso mb-2">Instant Check-In</h3>
            <p className="text-latte mb-4">Staff can scan this QR code to automatically perform their next attendance action without manual selection.</p>
            <div className="flex items-center gap-2 text-caramel font-bold bg-caramel/10 px-4 py-2 rounded-lg w-fit mx-auto md:mx-0">
              <QrCode size={20} /> <span>Scan to Action</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right: Sidebar Status */}
      <div className="space-y-6">
        <div className="glass-card rounded-3xl overflow-hidden shadow-xl">
          <div className="bg-ivy p-4 text-white font-bold flex items-center gap-2">
            <Timer size={18} /> On Duty ({onDuty.length})
          </div>
          <div className="p-4 space-y-3 max-h-[400px] overflow-y-auto">
            {onDuty.length === 0 && <p className="text-latte text-center py-4 italic">No one currently on duty</p>}
            {onDuty.map(s => {
              const r = attendance.find(a => a.staff_id === s.id);
              return (
                <div key={s.id} className="flex items-center justify-between p-3 bg-cream rounded-xl border border-latte/10">
                  <div>
                    <p className="font-bold text-sm">{s.name}</p>
                    <p className="text-[10px] text-latte uppercase tracking-wider">In: {r?.check_in}</p>
                  </div>
                  {r?.break_start && !r?.break_end ? (
                    <span className="text-[10px] font-bold text-caramel bg-caramel/10 px-2 py-1 rounded">ON BREAK</span>
                  ) : (
                    <span className="text-[10px] font-bold text-ivy bg-ivy/10 px-2 py-1 rounded">WORKING</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="glass-card rounded-3xl overflow-hidden shadow-xl">
          <div className="bg-latte p-4 text-white font-bold flex items-center gap-2">
            <Users size={18} /> Off Duty ({offDuty.length})
          </div>
          <div className="p-4 space-y-3 max-h-[400px] overflow-y-auto">
            {offDuty.map(s => (
              <div key={s.id} className="flex items-center justify-between p-3 bg-cream rounded-xl border border-latte/10 opacity-60">
                <div>
                  <p className="font-bold text-sm">{s.name}</p>
                  <p className="text-[10px] text-latte uppercase tracking-wider">{s.role}</p>
                </div>
                <ChevronRight size={14} className="text-latte" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionButton({ onClick, disabled, icon, label, color }: { onClick: () => void, disabled: boolean, icon: React.ReactNode, label: string, color: string }) {
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center justify-center gap-2 p-6 rounded-2xl text-white transition-all shadow-lg ${disabled ? 'bg-gray-300 cursor-not-allowed grayscale' : `${color} hover:scale-105 active:scale-95`}`}
    >
      <div className="p-2 bg-white/20 rounded-full">{icon}</div>
      <span className="font-bold text-sm">{label}</span>
    </button>
  );
}

function MonthlyReports({ staff, allAttendance }: { staff: Staff[], allAttendance: Attendance[] }) {
  const [filter, setFilter] = useState({ month: new Date().getMonth() + 1, year: new Date().getFullYear() });

  const monthlyData = useMemo(() => {
    const filtered = allAttendance.filter(a => {
      const d = new Date(a.date);
      return d.getMonth() + 1 === filter.month && d.getFullYear() === filter.year;
    });

    const chartData = staff.map(s => {
      const records = filtered.filter(a => a.staff_id === s.id);
      const present = records.filter(a => a.status === ATTENDANCE_STATUS.PRESENT || a.status === ATTENDANCE_STATUS.LATE).length;
      return { name: s.name, attendance: present };
    });

    return chartData;
  }, [allAttendance, filter, staff]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <h2 className="text-3xl font-bold text-espresso">Monthly Reports</h2>
        <div className="flex gap-2">
          <select 
            value={filter.month} 
            onChange={e => setFilter({...filter, month: parseInt(e.target.value)})}
            className="p-2 rounded-lg border border-latte bg-white"
          >
            {Array.from({length: 12}, (_, i) => (
              <option key={i+1} value={i+1}>{new Date(0, i).toLocaleString('en', {month: 'long'})}</option>
            ))}
          </select>
          <select 
            value={filter.year} 
            onChange={e => setFilter({...filter, year: parseInt(e.target.value)})}
            className="p-2 rounded-lg border border-latte bg-white"
          >
            {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="glass-card p-8 rounded-3xl shadow-xl">
        <h3 className="text-xl font-bold mb-6">Attendance Distribution</h3>
        <div className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#D4A574" opacity={0.2} />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#2C1810', fontSize: 12}} />
              <YAxis axisLine={false} tickLine={false} tick={{fill: '#2C1810', fontSize: 12}} />
              <Tooltip 
                cursor={{fill: '#F5EFE4'}}
                contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'}}
              />
              <Bar dataKey="attendance" radius={[8, 8, 0, 0]}>
                {monthlyData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#3D6B4A' : '#C8854A'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function StaffManagement({ staff }: { staff: Staff[] }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newStaff, setNewStaff] = useState<Staff>({
    id: '', name: '', role: '', shift_start: '09:00', shift_end: '18:00', week_off: 'Sunday'
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setDoc(doc(db, 'staff', newStaff.id), newStaff);
      setShowAdd(false);
      setNewStaff({ id: '', name: '', role: '', shift_start: '09:00', shift_end: '18:00', week_off: 'Sunday' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'staff');
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to remove this staff member?')) {
      try {
        await deleteDoc(doc(db, 'staff', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, 'staff');
      }
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold text-espresso">Staff Management</h2>
        <button 
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-caramel text-white px-6 py-3 rounded-xl hover:bg-caramel/90 transition-all shadow-lg font-bold"
        >
          <UserPlus size={20} /> Add Staff
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {staff.map(s => (
          <div key={s.id} className="glass-card p-6 rounded-2xl shadow-lg border border-latte/10 hover:shadow-2xl transition-all group">
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 bg-espresso rounded-xl flex items-center justify-center text-cream font-bold text-xl">
                {s.name[0]}
              </div>
              <button 
                onClick={() => handleDelete(s.id)}
                className="p-2 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all"
              >
                <Trash2 size={18} />
              </button>
            </div>
            <h3 className="text-xl font-bold text-espresso">{s.name}</h3>
            <p className="text-latte text-sm mb-4">{s.role} • {s.id}</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-latte">Shift</span>
                <span className="font-bold">{s.shift_start} - {s.shift_end}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-latte">Week Off</span>
                <span className="font-bold text-caramel">{s.week_off}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-espresso/60 backdrop-blur-sm">
          <div className="w-full max-w-md glass-card rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="bg-caramel p-6 text-white">
              <h3 className="text-2xl font-bold">Add New Member</h3>
            </div>
            <form onSubmit={handleAdd} className="p-8 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-latte mb-1">Staff ID</label>
                  <input type="text" required className="w-full p-3 rounded-lg border border-latte/20 bg-cream/30" value={newStaff.id} onChange={e => setNewStaff({...newStaff, id: e.target.value})} placeholder="TI008" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-latte mb-1">Name</label>
                  <input type="text" required className="w-full p-3 rounded-lg border border-latte/20 bg-cream/30" value={newStaff.name} onChange={e => setNewStaff({...newStaff, name: e.target.value})} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-latte mb-1">Role</label>
                <input type="text" required className="w-full p-3 rounded-lg border border-latte/20 bg-cream/30" value={newStaff.role} onChange={e => setNewStaff({...newStaff, role: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-latte mb-1">Shift Start</label>
                  <input type="time" required className="w-full p-3 rounded-lg border border-latte/20 bg-cream/30" value={newStaff.shift_start} onChange={e => setNewStaff({...newStaff, shift_start: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-latte mb-1">Shift End</label>
                  <input type="time" required className="w-full p-3 rounded-lg border border-latte/20 bg-cream/30" value={newStaff.shift_end} onChange={e => setNewStaff({...newStaff, shift_end: e.target.value})} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-latte mb-1">Week Off</label>
                <select className="w-full p-3 rounded-lg border border-latte/20 bg-cream/30" value={newStaff.week_off} onChange={e => setNewStaff({...newStaff, week_off: e.target.value})}>
                  {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'No weekoff'].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => setShowAdd(false)} className="flex-1 py-3 rounded-xl border border-latte text-latte font-bold">Cancel</button>
                <button type="submit" className="flex-1 py-3 rounded-xl bg-caramel text-white font-bold shadow-lg">Save Staff</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ViewerOverview({ staff, allAttendance }: { staff: Staff[], allAttendance: Attendance[] }) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredStaff = staff.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <h2 className="text-3xl font-bold text-espresso">Staff Overview</h2>
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-latte" size={18} />
          <input 
            type="text" 
            placeholder="Search staff..." 
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-latte/30 bg-white/50 focus:outline-none focus:ring-2 focus:ring-caramel"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredStaff.map(s => {
          const records = allAttendance.filter(a => a.staff_id === s.id);
          const present = records.filter(a => a.status === ATTENDANCE_STATUS.PRESENT || a.status === ATTENDANCE_STATUS.LATE).length;
          const late = records.filter(a => a.status === ATTENDANCE_STATUS.LATE).length;
          const percentage = records.length > 0 ? Math.round((present / records.length) * 100) : 0;

          return (
            <div key={s.id} className="glass-card rounded-3xl overflow-hidden shadow-xl border border-latte/10">
              <div className="bg-espresso p-6 text-cream">
                <div className="flex justify-between items-center mb-4">
                  <div className="w-10 h-10 bg-caramel rounded-full flex items-center justify-center font-bold">
                    {s.name[0]}
                  </div>
                  <span className="text-xs font-bold bg-white/10 px-3 py-1 rounded-full uppercase tracking-widest">{s.id}</span>
                </div>
                <h3 className="text-xl font-bold">{s.name}</h3>
                <p className="text-latte text-sm">{s.role}</p>
              </div>
              <div className="p-6 space-y-6">
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-xs text-latte uppercase font-bold tracking-wider">Attendance</p>
                    <p className="text-3xl font-black text-espresso">{percentage}%</p>
                  </div>
                  <div className="w-24 h-2 bg-cream rounded-full overflow-hidden">
                    <div className="h-full bg-ivy" style={{ width: `${percentage}%` }}></div>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-cream p-3 rounded-2xl">
                    <p className="text-[10px] text-latte uppercase font-bold">Present</p>
                    <p className="text-lg font-bold text-ivy">{present}</p>
                  </div>
                  <div className="bg-cream p-3 rounded-2xl">
                    <p className="text-[10px] text-latte uppercase font-bold">Late</p>
                    <p className="text-lg font-bold text-caramel">{late}</p>
                  </div>
                  <div className="bg-cream p-3 rounded-2xl">
                    <p className="text-[10px] text-latte uppercase font-bold">Days</p>
                    <p className="text-lg font-bold text-espresso">{records.length}</p>
                  </div>
                </div>

                <div className="pt-4 border-t border-latte/10">
                  <p className="text-xs text-latte font-bold uppercase mb-3 flex items-center gap-2">
                    <CalendarIcon size={14} /> Activity Heatmap
                  </p>
                  <div className="flex gap-1 flex-wrap">
                    {Array.from({length: 28}).map((_, i) => (
                      <div key={i} className={`w-3 h-3 rounded-sm ${i % 4 === 0 ? 'bg-ivy' : i % 7 === 0 ? 'bg-caramel' : 'bg-cream'}`}></div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
