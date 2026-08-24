import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, collection, doc, addDoc, updateDoc, 
  deleteDoc, onSnapshot, query, where 
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken 
} from 'firebase/auth';
import { 
  Plus, Trash2, ArrowLeft, CheckCircle2,
  Circle, Edit2, RotateCcw, ChevronRight, AlertCircle, RefreshCw, Settings, Users, Coins, X
} from 'lucide-react';

/**
 * 1. 強化型環境配置偵測 (相容性修復)
 * 為什麼：使用動態讀取方式避開 es2015 環境對 import.meta 的編譯報錯。
 */
const getFirebaseConfig = () => {
  // A. 優先檢查是否在預覽環境 (由系統注入)
  if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    return typeof __firebase_config === 'string' ? JSON.parse(__firebase_config) : __firebase_config;
  }

  // B. 本地 Vite 環境變數 (正確的讀取方式)
  // 在 Vite 中，我們應該直接、靜態地從 import.meta.env 讀取環境變數。
  // Vite 會在建置專案時，自動將這些變數替換成 .env.local 檔案中的真實值。
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || ""
  };
};

const firebaseConfig = getFirebaseConfig();
// 核心判斷：是否抓取到 projectId
const isValidConfig = firebaseConfig && firebaseConfig.projectId && firebaseConfig.projectId !== "";

// --- Firebase 初始化 ---
let app, auth, db;
if (isValidConfig) {
  try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (err) {
    console.error("Firebase 初始化失敗:", err);
  }
}

const APP_ID = 'AAApp'; 
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const PAGES = { HOME: 'home', SETTINGS: 'settings', PROJECT_DETAIL: 'project_detail', TRASH: 'trash' };
const DEFAULT_CURRENCIES = [
  { id: 'USD', code: 'USD', name: '美元', symbol: '$', builtIn: true },
  { id: 'JPY', code: 'JPY', name: '日圓', symbol: '¥', builtIn: true },
  { id: 'EUR', code: 'EUR', name: '歐元', symbol: '€', builtIn: true },
  { id: 'KRW', code: 'KRW', name: '韓元', symbol: '₩', builtIn: true },
  { id: 'CNY', code: 'CNY', name: '人民幣', symbol: '¥', builtIn: true },
  { id: 'HKD', code: 'HKD', name: '港幣', symbol: 'HK$', builtIn: true }
];

const calculateDebts = (expenses, projectId) => {
  const active = expenses.filter(e => e.projectId === projectId && !e.deletedAt && !e.settled);
  const balanceMap = {}, paidMap = {}, shareMap = {};
  active.forEach(exp => {
    const amount = Number(exp.amount) || 0;
    const debtors = exp.debtorIds || [];
    if (!debtors.length) return;
    const split = amount / debtors.length;
    balanceMap[exp.payerId] = (balanceMap[exp.payerId] || 0) + amount;
    paidMap[exp.payerId] = (paidMap[exp.payerId] || 0) + amount;
    debtors.forEach(id => {
      balanceMap[id] = (balanceMap[id] || 0) - split;
      shareMap[id] = (shareMap[id] || 0) + split;
    });
  });
  const balances = Object.keys(balanceMap).map(uid => ({ uid, net: balanceMap[uid], paid: paidMap[uid] || 0, share: shareMap[uid] || 0 })).sort((a,b) => b.net-a.net);
  const creditors = balances.filter(b => b.net > .5).map(b => ({ uid:b.uid, amt:b.net }));
  const debtors = balances.filter(b => b.net < -.5).map(b => ({ uid:b.uid, amt:-b.net }));
  const detailed = [];
  let ci=0, di=0;
  while (ci < creditors.length && di < debtors.length) {
    const pay = Math.min(creditors[ci].amt, debtors[di].amt);
    if (Math.round(pay) > 0) detailed.push({ from:debtors[di].uid, to:creditors[ci].uid, amount:String(Math.round(pay)) });
    creditors[ci].amt -= pay; debtors[di].amt -= pay;
    if (creditors[ci].amt < .5) ci++;
    if (debtors[di].amt < .5) di++;
  }
  return { balances, detailed };
};

// --- 錯誤提示 UI ---
const ErrorUI = () => (
  <div className="min-h-screen bg-[#F7F4EF] flex items-center justify-center p-6">
    <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-[#E5E1DA] max-w-md w-full text-center animate-in zoom-in-95 duration-300">
      <AlertCircle className="mx-auto text-[#C0A0A0] mb-4" size={48} />
      <h1 className="text-xl font-serif text-[#5B6D72] mb-2">尚未接通 Firebase</h1>
      <p className="text-sm text-[#A3A3A3] mb-6 leading-relaxed">
        目前抓不到 <code className="bg-[#F0F4F5] px-1 rounded text-[#94A7AE]">projectId</code>。這通常代表您的 <code className="bg-[#F0F4F5] px-1 rounded text-[#94A7AE]">.env.local</code> 檔案內容有誤，或變數名稱未加上 <code className="text-[#94A7AE]">VITE_</code> 前綴。
      </p>
      <div className="text-left bg-[#F9F8F6] p-4 rounded-2xl mb-6 text-xs text-[#6B7280] space-y-1 font-mono">
        <p>VITE_FIREBASE_PROJECT_ID=你的ID</p>
      </div>
      <button onClick={() => window.location.reload()} className="w-full bg-[#94A7AE] text-white py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-[#83969D] transition-all">
        <RefreshCw size={18} /> 我已設定並重啟服務，請重新載入
      </button>
    </div>
  </div>
);

const App = () => {
  if (!isValidConfig) return <ErrorUI />;

  // --- 狀態管理 ---
  const [user, setUser] = useState(null);
  const [currentPage, setCurrentPage] = useState(PAGES.HOME);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [globalUsers, setGlobalUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [customCurrencies, setCustomCurrencies] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState('');
  const [editingItem, setEditingItem] = useState(null);

  /**
   * 2. Firebase 認證與監聽
   */
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) { console.error("Firebase Auth Error:", err); }
    };
    initAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, setUser);
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) return;

    // 即時資料訂閱
    const unsubUsers = onSnapshot(collection(db, 'artifacts', APP_ID, 'public', 'data', 'users'), 
      (s) => setGlobalUsers(s.docs.map(d => ({id: d.id, ...d.data()}))),
      (e) => console.error("Users sync error:", e));

    const unsubProjects = onSnapshot(collection(db, 'artifacts', APP_ID, 'public', 'data', 'projects'), 
      (s) => setProjects(s.docs.map(d => ({id: d.id, ...d.data()}))),
      (e) => console.error("Projects sync error:", e));

    const unsubExpenses = onSnapshot(collection(db, 'artifacts', APP_ID, 'public', 'data', 'expenses'), 
      (s) => setExpenses(s.docs.map(d => ({id: d.id, ...d.data()}))),
      (e) => console.error("Expenses sync error:", e));

    const unsubCurrencies = onSnapshot(collection(db, 'artifacts', APP_ID, 'public', 'data', 'currencies'),
      (s) => setCustomCurrencies(s.docs.map(d => ({id: d.id, ...d.data()}))),
      (e) => console.error("Currencies sync error:", e));

    return () => { unsubUsers(); unsubProjects(); unsubExpenses(); unsubCurrencies(); };
  }, [user]);

  // --- 分帳演算邏輯 ---
  const projectDebts = useMemo(() => calculateDebts(expenses, currentProjectId), [expenses, currentProjectId]);
  const currencies = useMemo(() => [...DEFAULT_CURRENCIES, ...customCurrencies.filter(c => !c.deletedAt && !DEFAULT_CURRENCIES.some(d => d.code === c.code))], [customCurrencies]);

  // --- CRUD 操作 ---
  const handleAction = async (type, id, action) => {
    const colName = type === 'project' ? 'projects' : type === 'expense' ? 'expenses' : 'users';
    const docRef = doc(db, 'artifacts', APP_ID, 'public', 'data', colName, id);
    if (action === 'soft') await updateDoc(docRef, { deletedAt: Date.now() });
    else if (action === 'restore') await updateDoc(docRef, { deletedAt: null });
    else if (action === 'hard') await deleteDoc(docRef);
  };

  const Button = ({ children, onClick, variant = 'primary', className = '', type = "button" }) => {
    const styles = {
      primary: "bg-blue-600 text-white hover:bg-blue-700",
      secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200",
      outline: "border-2 border-blue-600 text-blue-700 hover:bg-blue-50",
      danger: "bg-rose-600 text-white hover:bg-rose-700"
    };
    return <button type={type} onClick={onClick} className={`px-4 py-2 rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2 font-medium shadow-sm ${styles[variant]} ${className}`}>{children}</button>;
  };

  const renderHome = () => (
    <div className="space-y-6 animate-in fade-in duration-500">
      <header className="flex justify-between items-center">
        <div><p className="text-xs font-bold text-blue-600 tracking-widest">AA APP</p><h1 className="text-3xl font-bold text-slate-900">日常分帳</h1></div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setCurrentPage(PAGES.TRASH)}><Trash2 size={18}/></Button>
          <Button variant="secondary" onClick={() => setCurrentPage(PAGES.SETTINGS)}><Settings size={19}/></Button>
          <Button onClick={() => { setModalType('project'); setEditingItem(null); setIsModalOpen(true); }}><Plus size={18}/> 新群組</Button>
        </div>
      </header>
      <div className="space-y-4">
        {projects.filter(p => !p.deletedAt).map(p => {
          const summary = calculateDebts(expenses, p.id);
          const members = globalUsers.filter(u => p.userIds?.includes(u.id) && !u.deletedAt);
          return (
          <div key={p.id} onClick={() => { setCurrentProjectId(p.id); setCurrentPage(PAGES.PROJECT_DETAIL); }}
               className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm group hover:border-blue-400 hover:shadow-md transition-all cursor-pointer">
            <div className="flex justify-between items-start gap-4">
              <div><h3 className="text-xl font-bold text-slate-900">{p.name}</h3><p className="text-xs text-slate-500 mt-1">{members.length} 位成員 · {expenses.filter(e => e.projectId === p.id && !e.deletedAt).length} 筆明細</p></div>
              <div className="flex gap-1 items-center">
                <button onClick={(e) => { e.stopPropagation(); setEditingItem(p); setModalType('project'); setIsModalOpen(true); }} className="p-2 text-slate-400 hover:text-blue-600"><Edit2 size={16}/></button>
                <button onClick={(e) => { e.stopPropagation(); handleAction('project', p.id, 'soft'); }} className="p-2 text-slate-400 hover:text-rose-600"><Trash2 size={16}/></button>
                <ChevronRight className="text-slate-300 group-hover:text-blue-600" size={20}/>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">{members.map(u => <span key={u.id} className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">{u.name}</span>)}</div>
            <div className="mt-4 pt-4 border-t border-slate-100 grid sm:grid-cols-2 gap-2">
              {summary.balances.length ? summary.balances.map(b => <div key={b.uid} className="flex justify-between text-sm bg-slate-50 rounded-lg px-3 py-2"><span>{globalUsers.find(u=>u.id===b.uid)?.name}</span><b className={b.net>.5?'text-emerald-600':b.net<-.5?'text-rose-600':'text-slate-400'}>{b.net>.5?`應收 $${Math.round(b.net)}`:b.net<-.5?`應付 $${Math.round(-b.net)}`:'已打平'}</b></div>) : <p className="text-sm text-slate-400 sm:col-span-2">尚無待結算帳務</p>}
            </div>
            {summary.detailed.length > 0 && <p className="mt-3 text-xs text-slate-500">建議轉帳：{summary.detailed.map(d => `${globalUsers.find(u=>u.id===d.from)?.name} → ${globalUsers.find(u=>u.id===d.to)?.name} $${d.amount}`).join('、')}</p>}
          </div>
        )})}
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <Button variant="secondary" onClick={() => setCurrentPage(PAGES.HOME)} className="p-2 rounded-full"><ArrowLeft size={20}/></Button>
        <h1 className="text-2xl font-bold text-slate-900">設定</h1>
      </header>
      <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
        <div className="flex items-center gap-3"><Users className="text-blue-600"/><div><h2 className="font-bold text-slate-900">常用成員</h2><p className="text-xs text-slate-500">建立群組時可直接加入</p></div></div>
        <div className="flex gap-2">
          <input id="userNameInput" placeholder="輸入成員姓名..." className="flex-1 bg-gray-50 border-none rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-[#94A7AE]" />
          <Button onClick={async () => {
            const input = document.getElementById('userNameInput');
            if (!input.value) return;
            await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'users'), { name: input.value, deletedAt: null });
            input.value = '';
          }}>新增</Button>
        </div>
        <div className="divide-y divide-gray-100">
          {globalUsers.filter(u => !u.deletedAt).map(u => (
            <div key={u.id} className="py-3 flex justify-between items-center group">
              <span className="text-slate-700">{u.name}</span>
              <button onClick={() => handleAction('user', u.id, 'soft')} className="text-slate-400 hover:text-rose-600"><Trash2 size={18}/></button>
            </div>
          ))}
        </div>
      </section>
      <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
        <div className="flex items-center gap-3"><Coins className="text-amber-600"/><div><h2 className="font-bold text-slate-900">外幣類別</h2><p className="text-xs text-slate-500">新增 ISO 幣別代碼供記帳選用</p></div></div>
        <form className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_64px_auto] gap-2" onSubmit={async e => {
          e.preventDefault(); const fd = new FormData(e.currentTarget); const code = String(fd.get('code')).toUpperCase().trim();
          if (!code || currencies.some(c => c.code === code)) return;
          await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'currencies'), { code, name:fd.get('currencyName'), symbol:fd.get('symbol') || code, deletedAt:null }); e.currentTarget.reset();
        }}>
          <input required name="currencyName" placeholder="名稱，如：泰銖" className="min-w-0 bg-slate-50 border rounded-xl px-3 py-2"/>
          <input required name="code" maxLength="3" placeholder="代碼 THB" className="min-w-0 bg-slate-50 border rounded-xl px-3 py-2 uppercase"/>
          <input name="symbol" placeholder="฿" className="min-w-0 bg-slate-50 border rounded-xl px-3 py-2"/>
          <Button type="submit">新增</Button>
        </form>
        <div className="flex flex-wrap gap-2">{currencies.map(c => <span key={c.id} className="flex items-center gap-2 px-3 py-2 bg-slate-50 border rounded-xl text-sm"><b>{c.code}</b><span className="text-slate-500">{c.name}</span>{!c.builtIn && <button onClick={() => updateDoc(doc(db,'artifacts',APP_ID,'public','data','currencies',c.id),{deletedAt:Date.now()})}><X size={14}/></button>}</span>)}</div>
      </section>
    </div>
  );

  const renderProjectDetail = () => {
    const project = projects.find(p => p.id === currentProjectId);
    if (!project) return null;
    const projectExpenses = expenses.filter(e => e.projectId === currentProjectId && !e.deletedAt);
    return (
      <div className="space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="secondary" onClick={() => setCurrentPage(PAGES.HOME)} className="p-2 rounded-full"><ArrowLeft size={20}/></Button>
            <h1 className="text-2xl font-bold text-slate-900">{project.name}</h1>
          </div>
          <Button onClick={() => { setModalType('expense'); setEditingItem(null); setIsModalOpen(true); }}><Plus size={18}/> 記一筆</Button>
        </header>
        <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100 space-y-4">
          <h3 className="text-xs font-bold text-blue-700 tracking-widest uppercase">債務分析</h3>
          
          {/* 顯示個人淨額與實際支出明細 */}
          {projectDebts.balances?.length > 0 && (
            <div className="flex flex-col gap-2 mb-4 border-b border-[#DCE4E6] pb-4">
              {projectDebts.balances.map(b => (
                <div key={b.uid} className={`px-4 py-2.5 rounded-xl text-sm flex justify-between items-center shadow-sm bg-white border ${Math.abs(b.net) < 0.5 ? 'text-slate-400 border-slate-200' : b.net > 0 ? 'text-emerald-700 border-emerald-200' : 'text-rose-700 border-rose-200'}`}>
                  <div>
                    <span className="font-bold block">{globalUsers.find(u => u.id === b.uid)?.name}</span>
                    <span className="text-[10px] opacity-70">
                      實際分攤 ${Math.round(b.share)} / 已墊付 ${Math.round(b.paid)}
                    </span>
                  </div>
                  <span className="font-bold text-base">
                    {Math.abs(b.net) < 0.5 ? '打平 $0' : b.net > 0 ? `應收 $${Math.round(Math.abs(b.net))}` : `應付 $${Math.round(Math.abs(b.net))}`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {projectDebts.detailed?.length > 0 ? projectDebts.detailed.map((d, i) => (
            <div key={i} className="flex items-center justify-center gap-3 py-1 text-sm text-[#5B6D72]">
              <span className="bg-white px-3 py-1 rounded-lg shadow-sm font-medium">{globalUsers.find(u => u.id === d.from)?.name}</span>
              <span className="text-[#94A7AE] font-mono font-bold text-xs bg-[#F0F4F5] px-2 py-1 rounded-lg border border-[#DCE4E6]">
                --${d.amount}-&gt;
              </span>
              <span className="bg-white px-3 py-1 rounded-lg shadow-sm font-medium">{globalUsers.find(u => u.id === d.to)?.name}</span>
            </div>
          )) : <p className="text-center text-[#A3A3A3] italic py-2 text-sm">目前帳務已清清囉！</p>}
        </div>
        <div className="space-y-3">
          {projectExpenses.sort((a,b) => b.date?.localeCompare(a.date)).map(exp => (
            <div key={exp.id} className={`p-4 rounded-2xl border transition-all ${exp.settled ? 'bg-gray-50 opacity-40 grayscale' : 'bg-white shadow-sm hover:border-[#94A7AE]'}`}>
              <div className="flex items-center gap-4">
                <button onClick={() => updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'expenses', exp.id), { settled: !exp.settled })}>
                  {exp.settled ? <CheckCircle2 className="text-[#94A7AE]" /> : <Circle className="text-gray-300" />}
                </button>
                <div className="flex-1" onClick={() => !exp.settled && (setEditingItem(exp), setModalType('expense'), setIsModalOpen(true))}>
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium text-[#6B7280]">{exp.name}</h4>
                      <p className="text-[10px] text-[#A3A3A3] mt-1 flex gap-3">
                        <span>{exp.date}</span>
                        <span>{globalUsers.find(u => u.id === exp.payerId)?.name} 付</span>
                      </p>
                    </div>
                    <div className="text-right"><span className="text-xl font-bold text-slate-900">NT$ {Number(exp.amount).toLocaleString()}</span>{exp.isForeign && <p className="text-[10px] text-amber-700 mt-1">{exp.currencySymbol} {Number(exp.foreignAmount).toLocaleString()} {exp.currencyCode} · 匯率 {exp.exchangeRate}</p>}</div>
                  </div>
                </div>
                {!exp.settled && <button onClick={() => handleAction('expense', exp.id, 'soft')} className="text-[#C0A0A0] hover:scale-110 transition-transform"><Trash2 size={16}/></button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTrash = () => {
    const now = Date.now();
    const trash = [...projects, ...expenses, ...globalUsers].filter(i => i.deletedAt && (now - i.deletedAt < THREE_DAYS_MS));
    return (
      <div className="space-y-6">
        <header className="flex items-center gap-4">
          <Button variant="secondary" onClick={() => setCurrentPage(PAGES.HOME)} className="p-2 rounded-full"><ArrowLeft size={20}/></Button>
          <h1 className="text-2xl font-serif text-[#5B6D72]">資源回收 (3天內)</h1>
        </header>
        <div className="space-y-3">
          {trash.map(item => (
            <div key={item.id} className="bg-white p-4 rounded-2xl border flex justify-between items-center shadow-sm">
              <div>
                <span className="text-[10px] text-[#94A7AE] font-bold uppercase block mb-1">
                  {item.amount ? '記帳' : (item.userIds ? '專案' : '成員')}
                </span>
                <span className="text-[#6B7280]">{item.name || '未命名'}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleAction((item.amount ? 'expense' : (item.userIds ? 'project' : 'user')), item.id, 'restore')} className="p-2 rounded-full"><RotateCcw size={16}/></Button>
                <Button variant="secondary" onClick={() => handleAction((item.amount ? 'expense' : (item.userIds ? 'project' : 'user')), item.id, 'hard')} className="p-2 text-[#C0A0A0] rounded-full"><Trash2 size={16}/></Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const Modal = () => {
    if (!isModalOpen) return null;
    const project = projects.find(p => p.id === currentProjectId);
    const [isForeign, setIsForeign] = useState(Boolean(editingItem?.isForeign));
    const [currencyCode, setCurrencyCode] = useState(editingItem?.currencyCode || currencies[0]?.code || 'USD');
    const [exchangeRate, setExchangeRate] = useState(editingItem?.exchangeRate || '');
    const [rateStatus, setRateStatus] = useState('');
    const fetchRate = async () => {
      setRateStatus('loading');
      try {
        const response = await fetch(`https://api.frankfurter.app/latest?from=${currencyCode}&to=TWD`);
        if (!response.ok) throw new Error('rate request failed');
        const result = await response.json();
        if (!result.rates?.TWD) throw new Error('rate unavailable');
        setExchangeRate(result.rates.TWD); setRateStatus('success');
      } catch { setRateStatus('error'); }
    };
    return (
      <div className="fixed inset-0 bg-[#5B6D72]/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 animate-in zoom-in-95 border border-slate-200 max-h-[92vh] overflow-y-auto">
          <form onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const data = Object.fromEntries(fd.entries());
            try {
              if (modalType === 'project') {
                const uids = globalUsers.filter(u => !u.deletedAt && fd.get(`u_${u.id}`)).map(u => u.id);
                const p = { name: data.name || "", userIds: uids, deletedAt: null };
                editingItem ? await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'projects', editingItem.id), p) : await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'projects'), p);
              } else {
                const dIds = globalUsers.filter(u => !u.deletedAt && fd.get(`d_${u.id}`)).map(u => u.id);
                const foreignAmount = Number(data.amount) || 0;
                const selectedCurrency = currencies.find(c => c.code === data.currencyCode);
                const convertedAmount = isForeign ? Math.round(foreignAmount * (Number(data.exchangeRate) || 0) * 100) / 100 : foreignAmount;
                const p = { 
                  projectId: currentProjectId, 
                  name: data.name || "", 
                  amount: convertedAmount,
                  isForeign,
                  foreignAmount: isForeign ? foreignAmount : null,
                  currencyCode: isForeign ? data.currencyCode : null,
                  currencySymbol: isForeign ? (selectedCurrency?.symbol || data.currencyCode) : null,
                  exchangeRate: isForeign ? Number(data.exchangeRate) : null,
                  date: data.date || "", 
                  payerId: data.payerId || "", 
                  debtorIds: dIds, 
                  notes: data.notes || "", 
                  settled: editingItem?.settled || false, 
                  deletedAt: null 
                };
                editingItem ? await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'expenses', editingItem.id), p) : await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'expenses'), p);
              }
              setIsModalOpen(false);
            } catch (err) { console.error("儲存失敗:", err); }
          }} className="space-y-5">
            <h2 className="text-2xl font-serif text-[#5B6D72]">{editingItem ? '編輯' : '新增'}{modalType==='project'?'專案':'帳務'}</h2>
            <div className="space-y-4">
              <input required name="name" defaultValue={editingItem?.name} placeholder="名稱" className="w-full bg-white border border-[#E5E1DA] rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#94A7AE]" />
              {modalType === 'project' ? (
                <div className="max-h-40 overflow-y-auto space-y-1 p-2 bg-white rounded-xl border">
                  {globalUsers.filter(u => !u.deletedAt).map(u => (
                    <label key={u.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer">
                      <input type="checkbox" name={`u_${u.id}`} defaultChecked={editingItem?.userIds?.includes(u.id)} />
                      <span className="text-sm text-[#6B7280]">{u.name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <>
                  <div className="flex gap-3">
                    <input required name="amount" type="number" min="0" step="any" defaultValue={editingItem?.isForeign ? editingItem.foreignAmount : editingItem?.amount} placeholder="金額" className="w-1/2 bg-white border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500" />
                    <input required name="date" type="date" defaultValue={editingItem?.date || new Date().toISOString().split('T')[0]} className="w-1/2 bg-white border border-[#E5E1DA] rounded-xl px-4 py-3 outline-none" />
                  </div>
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <label className="flex items-center justify-between p-4 cursor-pointer bg-white">
                      <span><b className="block text-sm text-slate-800">使用外幣</b><span className="text-xs text-slate-500">換算為新台幣後加入分帳</span></span>
                      <input type="checkbox" checked={isForeign} onChange={e => setIsForeign(e.target.checked)} className="w-5 h-5 accent-blue-600"/>
                    </label>
                    {isForeign && <div className="p-4 bg-amber-50 border-t border-amber-100 space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <select name="currencyCode" value={currencyCode} onChange={e=>{setCurrencyCode(e.target.value);setRateStatus('')}} className="bg-white border border-amber-200 rounded-xl px-3 py-2">
                          {currencies.map(c => <option key={c.id} value={c.code}>{c.code} · {c.name}</option>)}
                        </select>
                        <input required name="exchangeRate" type="number" min="0" step="any" value={exchangeRate} onChange={e=>setExchangeRate(e.target.value)} placeholder="1 外幣 = ? TWD" className="bg-white border border-amber-200 rounded-xl px-3 py-2"/>
                      </div>
                      <button type="button" onClick={fetchRate} disabled={rateStatus==='loading'} className="w-full py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium flex justify-center items-center gap-2"><RefreshCw size={15} className={rateStatus==='loading'?'animate-spin':''}/>{rateStatus==='loading'?'查詢中…':'取得今日匯率'}</button>
                      <p className={`text-xs ${rateStatus==='error'?'text-rose-600':'text-amber-800'}`}>{rateStatus==='success'?'已取得今日參考匯率，可再手動調整。':rateStatus==='error'?'此幣別暫無線上匯率，請手動輸入。':'匯率定義：1 單位外幣可兌換多少新台幣。'}</p>
                    </div>}
                  </div>
                  <select name="payerId" defaultValue={editingItem?.payerId} className="w-full bg-white border border-[#E5E1DA] rounded-xl px-4 py-3">
                    {globalUsers.filter(u => !u.deletedAt && project?.userIds?.includes(u.id)).map(u => <option key={u.id} value={u.id}>{u.name} 付款</option>)}
                  </select>
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-[#A3A3A3] uppercase">分攤名單</p>
                    <div className="max-h-32 overflow-y-auto grid grid-cols-2 gap-2 p-2 bg-white rounded-xl border">
                      {globalUsers.filter(u => !u.deletedAt && project?.userIds?.includes(u.id)).map(u => (
                        <label key={u.id} className="flex items-center gap-2 text-xs text-[#6B7280]">
                          <input type="checkbox" name={`d_${u.id}`} defaultChecked={editingItem ? editingItem.debtorIds?.includes(u.id) : true} /> {u.name}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setIsModalOpen(false)}>取消</Button>
              <Button type="submit" className="flex-1">儲存資料</Button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-700 pb-20 font-sans selection:bg-blue-200">
      {!user ? (
        <div className="flex h-screen items-center justify-center">
          <div className="w-10 h-10 border-4 border-[#94A7AE] border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : (
        <div className="max-w-xl mx-auto px-6 py-10">
          {currentPage === PAGES.HOME && renderHome()}
          {currentPage === PAGES.SETTINGS && renderSettings()}
          {currentPage === PAGES.TRASH && renderTrash()}
          {currentPage === PAGES.PROJECT_DETAIL && renderProjectDetail()}
        </div>
      )}
      {isModalOpen && <Modal />}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@600;700&family=Noto+Sans+TC:wght@400;500&display=swap');
        body { font-family: 'Noto Sans TC', sans-serif; background-color: #f8fafc; }
        .font-serif { font-family: 'Noto Serif TC', serif; }
      `}</style>
    </div>
  );
};

export default App;
