import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, doc, addDoc, updateDoc, 
  deleteDoc, onSnapshot, query, getDoc 
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken 
} from 'firebase/auth';
import { 
  Plus, UserPlus, Trash2, ArrowLeft, CheckCircle2, 
  Circle, Edit2, RotateCcw, DollarSign, Calendar, FileText
} from 'lucide-react';

/**
 * 安全地解析 Firebase 配置
 * 為什麼要這樣做：在本地環境開發時，__firebase_config 可能未定義，這會導致程式中斷。
 */
const getSafeConfig = () => {
  try {
    if (typeof __firebase_config !== 'undefined') {
      return typeof __firebase_config === 'string' ? JSON.parse(__firebase_config) : __firebase_config;
    }
  } catch (e) {
    console.error("Firebase config parse error:", e);
  }
  return { apiKey: "placeholder" }; // 僅作為類型占位
};

const firebaseConfig = getSafeConfig();
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 優先使用注入的 appId，否則預設為 AAApp
const appId = typeof __app_id !== 'undefined' ? __app_id : 'AAApp';

// 常數：定義垃圾桶保留時間 (3天)
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

// 定義頁面路由狀態，避免使用字串硬編碼，減少錯字風險
const PAGES = {
  HOME: 'home',
  USER_EDIT: 'user_edit',
  TRASH: 'trash',
  PROJECT_DETAIL: 'project_detail'
};

const App = () => {
  // --- 狀態管理 (State Management) ---
  const [user, setUser] = useState(null);
  const [currentPage, setCurrentPage] = useState(PAGES.HOME);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  
  // 核心資料流
  const [globalUsers, setGlobalUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [expenses, setExpenses] = useState([]);
  
  // UI 互動控制
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState(''); // 'project' | 'expense'
  const [editingItem, setEditingItem] = useState(null);

  /**
   * 步驟 1: 身份驗證流程
   * 為什麼：Firestore 所有操作都需要在 Auth 完成後才能執行，以符合安全規則。
   */
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth failed:", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubscribe();
  }, []);

  /**
   * 步驟 2: 資料訂閱
   * 為什麼：使用 onSnapshot 實作實時同步（Real-time），使用者 A 記帳，使用者 B 畫面會自動更新。
   */
  useEffect(() => {
    if (!user) return;

    const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'users');
    const unsubUsers = onSnapshot(usersRef, (snap) => {
      setGlobalUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Users sync error:", err));

    const projectsRef = collection(db, 'artifacts', appId, 'public', 'data', 'projects');
    const unsubProjects = onSnapshot(projectsRef, (snap) => {
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Projects sync error:", err));

    const expensesRef = collection(db, 'artifacts', appId, 'public', 'data', 'expenses');
    const unsubExpenses = onSnapshot(expensesRef, (snap) => {
      setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Expenses sync error:", err));

    return () => { unsubUsers(); unsubProjects(); unsubExpenses(); };
  }, [user]);

  /**
   * 邏輯：計算債務
   * 為什麼：這是在前端計算而非儲存於資料庫，確保資料的一致性與動態性。
   */
  const projectDebts = useMemo(() => {
    if (!currentProjectId) return [];
    
    // 只計算目前專案中「未刪除」且「未結清」的帳目
    const activeExpenses = expenses.filter(e => 
      e.projectId === currentProjectId && !e.deletedAt && !e.settled
    );
    
    const balanceMap = {}; 
    
    activeExpenses.forEach(exp => {
      const amount = parseFloat(exp.amount) || 0;
      const payerId = exp.payerId;
      const debtorIds = exp.debtorIds || [];
      if (!debtorIds.length) return;
      
      const splitAmount = amount / debtorIds.length;
      balanceMap[payerId] = (balanceMap[payerId] || 0) + amount;
      debtorIds.forEach(id => {
        balanceMap[id] = (balanceMap[id] || 0) - splitAmount;
      });
    });

    const creditors = [];
    const debtors = [];
    Object.keys(balanceMap).forEach(uid => {
      if (balanceMap[uid] > 0.1) creditors.push({ uid, amount: balanceMap[uid] });
      else if (balanceMap[uid] < -0.1) debtors.push({ uid, amount: Math.abs(balanceMap[uid]) });
    });

    const detailed = [];
    let ci = 0, di = 0;
    while (ci < creditors.length && di < debtors.length) {
      const pay = Math.min(creditors[ci].amount, debtors[di].amount);
      detailed.push({ from: debtors[di].uid, to: creditors[ci].uid, amount: pay.toFixed(0) });
      creditors[ci].amount -= pay;
      debtors[di].amount -= pay;
      if (creditors[ci].amount < 0.1) ci++;
      if (debtors[di].amount < 0.1) di++;
    }
    return detailed;
  }, [expenses, currentProjectId]);

  // --- 資料操作邏輯 (CRUD) ---

  const handleAction = async (type, id, action) => {
    const colName = type === 'project' ? 'projects' : type === 'expense' ? 'expenses' : 'users';
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', colName, id);
    
    if (action === 'softDelete') await updateDoc(docRef, { deletedAt: Date.now() });
    if (action === 'restore') await updateDoc(docRef, { deletedAt: null });
    if (action === 'hardDelete') await deleteDoc(docRef);
  };

  // --- UI 元件與子頁面渲染 ---

  const Button = ({ children, onClick, variant = 'primary', className = '', type = "button" }) => {
    const base = "px-4 py-2 rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2 font-medium shadow-sm disabled:opacity-50";
    const styles = {
      primary: "bg-[#94A7AE] text-white hover:bg-[#83969D]",
      secondary: "bg-[#E5E1DA] text-[#6B7280] hover:bg-[#D7D2C8]",
      danger: "bg-[#C0A0A0] text-white hover:bg-[#B08F8F]",
      outline: "border-2 border-[#94A7AE] text-[#94A7AE] hover:bg-[#F0F4F5]"
    };
    return <button type={type} onClick={onClick} className={`${base} ${styles[variant]} ${className}`}>{children}</button>;
  };

  // 1. 渲染首頁
  const renderHome = () => (
    <div className="space-y-6 animate-in fade-in duration-500">
      <header className="flex justify-between items-center">
        <h1 className="text-3xl font-serif text-[#5B6D72]">日常分帳</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setCurrentPage(PAGES.TRASH)}><Trash2 size={18} /></Button>
          <Button onClick={() => { setModalType('project'); setEditingItem(null); setIsModalOpen(true); }}><Plus size={18} /> 新專案</Button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {projects.filter(p => !p.deletedAt).map(project => (
          <div key={project.id} onClick={() => { setCurrentProjectId(project.id); setCurrentPage(PAGES.PROJECT_DETAIL); }}
               className="bg-white p-5 rounded-3xl shadow-sm border border-[#F0EBE3] group hover:border-[#94A7AE] transition-all cursor-pointer hover:shadow-md">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-xl font-medium text-[#6B7280]">{project.name}</h3>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={(e) => { e.stopPropagation(); setEditingItem(project); setModalType('project'); setIsModalOpen(true); }} className="text-[#94A7AE]"><Edit2 size={16} /></button>
                <button onClick={(e) => { e.stopPropagation(); handleAction('project', project.id, 'softDelete'); }} className="text-[#C0A0A0]"><Trash2 size={16} /></button>
              </div>
            </div>
            <div className="text-sm text-[#A3A3A3] flex items-center gap-2">
              <UserPlus size={14} /> {project.userIds?.length || 0} 位成員
            </div>
          </div>
        ))}
      </div>
      
      <Button variant="outline" className="w-full py-4 border-dashed" onClick={() => setCurrentPage(PAGES.USER_EDIT)}>
        <UserPlus size={20} /> 管理常用成員
      </Button>
    </div>
  );

  // 2. 渲染常用成員
  const renderUserEdit = () => (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <Button variant="secondary" onClick={() => setCurrentPage(PAGES.HOME)} className="p-2 rounded-full"><ArrowLeft size={20} /></Button>
        <h1 className="text-2xl font-serif text-[#5B6D72]">常用成員</h1>
      </header>
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-[#F0EBE3] space-y-4">
        <div className="flex gap-2">
          <input id="newUserName" placeholder="輸入成員姓名..." className="flex-1 bg-[#F9F8F6] border-none rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-[#94A7AE]" />
          <Button onClick={async () => {
            const el = document.getElementById('newUserName');
            if (!el.value) return;
            await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'users'), { name: el.value, createdAt: Date.now(), deletedAt: null });
            el.value = '';
          }}>新增</Button>
        </div>
        <div className="divide-y divide-[#F0EBE3]">
          {globalUsers.filter(u => !u.deletedAt).map(u => (
            <div key={u.id} className="py-3 flex justify-between items-center group">
              <span className="text-[#6B7280]">{u.name}</span>
              <button onClick={() => handleAction('user', u.id, 'softDelete')} className="text-[#C0A0A0] opacity-0 group-hover:opacity-100"><Trash2 size={18} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // 3. 專案詳情
  const renderProjectDetail = () => {
    const project = projects.find(p => p.id === currentProjectId);
    if (!project) return null;
    const projectExpenses = expenses.filter(e => e.projectId === currentProjectId && !e.deletedAt);

    return (
      <div className="space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="secondary" onClick={() => setCurrentPage(PAGES.HOME)} className="p-2 rounded-full"><ArrowLeft size={20} /></Button>
            <h1 className="text-2xl font-serif text-[#5B6D72]">{project.name}</h1>
          </div>
          <Button onClick={() => { setModalType('expense'); setEditingItem(null); setIsModalOpen(true); }}><Plus size={18} /> 記一筆</Button>
        </header>

        {/* 債務摘要 */}
        <div className="bg-[#F0F4F5] rounded-3xl p-6 border border-[#DCE4E6] space-y-3">
          <h3 className="text-sm font-semibold text-[#83969D] tracking-widest uppercase">債務清單</h3>
          {projectDebts.length > 0 ? projectDebts.map((d, i) => (
            <div key={i} className="flex items-center justify-between text-[#5B6D72]">
              <span className="font-medium">{globalUsers.find(u => u.id === d.from)?.name}</span>
              <div className="flex-1 border-t-2 border-dashed border-[#BDC9CD] mx-4 relative">
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#F0F4F5] px-2 text-xs font-bold text-[#94A7AE]">${d.amount}</span>
              </div>
              <span className="font-medium">{globalUsers.find(u => u.id === d.to)?.name}</span>
            </div>
          )) : <p className="text-[#A3A3A3] text-center italic">暫無欠款</p>}
        </div>

        {/* 記帳清單 */}
        <div className="space-y-3">
          {projectExpenses.sort((a,b) => b.date.localeCompare(a.date)).map(exp => (
            <div key={exp.id} className={`p-4 rounded-2xl border transition-all ${exp.settled ? 'bg-gray-50 opacity-50 grayscale' : 'bg-white shadow-sm hover:border-[#94A7AE]'}`}>
              <div className="flex items-center gap-4">
                <button onClick={async () => await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'expenses', exp.id), { settled: !exp.settled })}>
                  {exp.settled ? <CheckCircle2 className="text-[#94A7AE]" /> : <Circle className="text-gray-300" />}
                </button>
                <div className="flex-1" onClick={() => { if(!exp.settled) { setEditingItem(exp); setModalType('expense'); setIsModalOpen(true); } }}>
                  <div className="flex justify-between"><h4 className="font-medium text-[#6B7280]">{exp.name}</h4><span className="text-[#5B6D72] font-serif">${exp.amount}</span></div>
                  <div className="text-[10px] text-[#A3A3A3] mt-1 flex gap-3">
                    <span>{exp.date}</span>
                    <span>{globalUsers.find(u => u.id === exp.payerId)?.name} 付</span>
                  </div>
                </div>
                {!exp.settled && <button onClick={() => handleAction('expense', exp.id, 'softDelete')} className="text-[#C0A0A0]"><Trash2 size={16} /></button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // 4. 資源回收
  const renderTrash = () => {
    const now = Date.now();
    const trash = [
      ...projects.filter(p => p.deletedAt).map(p => ({ ...p, type: 'project' })),
      ...expenses.filter(e => e.deletedAt).map(e => ({ ...e, type: 'expense' })),
      ...globalUsers.filter(u => u.deletedAt).map(u => ({ ...u, type: 'user' }))
    ].filter(item => (now - item.deletedAt) < THREE_DAYS_MS);

    return (
      <div className="space-y-6">
        <header className="flex items-center gap-4">
          <Button variant="secondary" onClick={() => setCurrentPage(PAGES.HOME)} className="p-2 rounded-full"><ArrowLeft size={20} /></Button>
          <h1 className="text-2xl font-serif text-[#5B6D72]">資源回收 (3天內)</h1>
        </header>
        <div className="space-y-3">
          {trash.map(item => (
            <div key={item.id} className="bg-white p-4 rounded-2xl border flex justify-between items-center shadow-sm">
              <div>
                <span className="text-[10px] text-[#94A7AE] font-bold uppercase block">{item.type}</span>
                <span className="text-[#6B7280]">{item.name || '未命名'}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleAction(item.type, item.id, 'restore')} className="p-2"><RotateCcw size={16} /></Button>
                <Button variant="secondary" onClick={() => handleAction(item.type, item.id, 'hardDelete')} className="p-2 text-[#C0A0A0]"><Trash2 size={16} /></Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // --- Modal 表單 ---
  const Modal = () => {
    if (!isModalOpen) return null;
    const project = projects.find(p => p.id === currentProjectId);

    return (
      <div className="fixed inset-0 bg-[#5B6D72]/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-[#FAF9F6] w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden p-8 animate-in zoom-in-95">
          <form onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const data = Object.fromEntries(fd.entries());
            
            if (modalType === 'project') {
              const uids = globalUsers.filter(u => !u.deletedAt && fd.get(`u_${u.id}`)).map(u => u.id);
              const payload = { name: data.name, userIds: uids, deletedAt: null };
              editingItem ? await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'projects', editingItem.id), payload) : await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'projects'), payload);
            } else {
              const dIds = globalUsers.filter(u => !u.deletedAt && fd.get(`d_${u.id}`)).map(u => u.id);
              const payload = { projectId: currentProjectId, name: data.name, amount: data.amount, date: data.date, payerId: data.payerId, debtorIds: dIds, notes: data.notes, settled: editingItem?.settled || false, deletedAt: null };
              editingItem ? await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'expenses', editingItem.id), payload) : await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'expenses'), payload);
            }
            setIsModalOpen(false);
          }} className="space-y-4">
            <h2 className="text-xl font-serif text-[#5B6D72]">{editingItem ? '編輯' : '新增'}{modalType === 'project' ? '專案' : '帳務'}</h2>
            
            <input required name="name" defaultValue={editingItem?.name} placeholder="名稱" className="w-full bg-white border border-[#E5E1DA] rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-[#94A7AE]" />
            
            {modalType === 'project' ? (
              <div className="space-y-2">
                <p className="text-xs font-bold text-[#A3A3A3]">選取專案成員</p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {globalUsers.filter(u => !u.deletedAt).map(u => (
                    <label key={u.id} className="flex items-center gap-2 text-sm text-[#6B7280]">
                      <input type="checkbox" name={`u_${u.id}`} defaultChecked={editingItem?.userIds?.includes(u.id)} /> {u.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input required name="amount" type="number" defaultValue={editingItem?.amount} placeholder="金額" className="w-1/2 bg-white border border-[#E5E1DA] rounded-xl px-4 py-2" />
                  <input required name="date" type="date" defaultValue={editingItem?.date || new Date().toISOString().split('T')[0]} className="w-1/2 bg-white border border-[#E5E1DA] rounded-xl px-4 py-2" />
                </div>
                <select name="payerId" defaultValue={editingItem?.payerId} className="w-full bg-white border border-[#E5E1DA] rounded-xl px-4 py-2">
                  {globalUsers.filter(u => !u.deletedAt && project?.userIds?.includes(u.id)).map(u => <option key={u.id} value={u.id}>{u.name} 付款</option>)}
                </select>
                <div className="space-y-2">
                  <p className="text-xs font-bold text-[#A3A3A3]">分攤成員</p>
                  <div className="max-h-32 overflow-y-auto grid grid-cols-2 gap-1">
                    {globalUsers.filter(u => !u.deletedAt && project?.userIds?.includes(u.id)).map(u => (
                      <label key={u.id} className="flex items-center gap-2 text-xs text-[#6B7280]">
                        <input type="checkbox" name={`d_${u.id}`} defaultChecked={editingItem ? editingItem.debtorIds?.includes(u.id) : true} /> {u.name}
                      </label>
                    ))}
                  </div>
                </div>
                <input name="notes" defaultValue={editingItem?.notes} placeholder="備註" className="w-full bg-white border border-[#E5E1DA] rounded-xl px-4 py-2" />
              </>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="secondary" className="flex-1" onClick={() => setIsModalOpen(false)}>取消</Button>
              <Button type="submit" className="flex-1">確定儲存</Button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F7F4EF] text-[#444] pb-20">
      <div className="max-w-xl mx-auto px-4 py-8">
        {!user ? <div className="flex h-64 items-center justify-center"><div className="w-8 h-8 border-4 border-[#94A7AE] border-t-transparent rounded-full animate-spin"></div></div> : (
          <>
            {currentPage === PAGES.HOME && renderHome()}
            {currentPage === PAGES.USER_EDIT && renderUserEdit()}
            {currentPage === PAGES.TRASH && renderTrash()}
            {currentPage === PAGES.PROJECT_DETAIL && renderProjectDetail()}
          </>
        )}
      </div>
      <Modal />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@600;700&family=Noto+Sans+TC&display=swap');
        body { font-family: 'Noto Sans TC', sans-serif; }
        .font-serif { font-family: 'Noto Serif TC', serif; }
      `}</style>
    </div>
  );
};

export default App;