import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, getDocs, getDoc, addDoc, deleteDoc, updateDoc, query, orderBy, where } from 'firebase/firestore';

// Konfigurasi Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDmI0zRauvzaL4oEuXinkmXhGiwTsYxYQc",
    authDomain: "insan-cemerlang-ee7af.firebaseapp.com",
    projectId: "insan-cemerlang-ee7af",
    storageBucket: "insan-cemerlang-ee7af.appspot.com",
    messagingSenderId: "1047091827759",
    appId: "1:1047091827759:web:0f1742d6f3922f856de2da",
    measurementId: "G-GL8J5GC8XB"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const booksCol = collection(db, "books");
const membersCol = collection(db, "members");
const usersCol = collection(db, "users");
const loansCol = collection(db, "loans");
const returnsCol = collection(db, "returns");

let currentUser = null;
let modalCallback = null;
const DAILY_FINE = 1000;

// Helper functions
function showToast(msg, type = "success") {
    const toast = document.createElement("div");
    toast.className = `fixed bottom-5 right-5 z-50 px-5 py-3 rounded-xl shadow-lg text-white font-medium flex items-center gap-2 ${type === 'error' ? 'bg-red-500' : 'bg-pink-500'}`;
    toast.innerHTML = `<i class="fas ${type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle'}"></i> ${msg}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function formatDate(dateObj) {
    if (!dateObj) return '-';
    return new Date(dateObj).toLocaleDateString('id-ID');
}

function getDueDate(loanDate) {
    const due = new Date(loanDate);
    due.setDate(due.getDate() + 7);
    return due.toISOString();
}

function isOverdue(dueDate) {
    return new Date() > new Date(dueDate);
}

function calculateLateFee(dueDateStr, returnDateStr) {
    const due = new Date(dueDateStr);
    const ret = new Date(returnDateStr);
    if (ret <= due) return 0;
    const diffDays = Math.ceil((ret - due) / (1000 * 60 * 60 * 24));
    return diffDays * DAILY_FINE;
}

// Cache management
let cachedBooks = [];
let cachedMembers = [];
let cachedUsers = [];
let lastFetchTime = 0;
const CACHE_TTL = 30000;

async function loadBooksForce() {
    const snap = await getDocs(query(booksCol, orderBy("title")));
    cachedBooks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return cachedBooks;
}
async function loadMembersForce() {
    const snap = await getDocs(query(membersCol, orderBy("name")));
    cachedMembers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return cachedMembers;
}
async function loadUsersForce() {
    const snap = await getDocs(usersCol);
    cachedUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return cachedUsers;
}
async function loadBooks() {
    if (cachedBooks.length === 0 || Date.now() - lastFetchTime > CACHE_TTL) await loadBooksForce();
    return cachedBooks;
}
async function loadMembers() {
    if (cachedMembers.length === 0 || Date.now() - lastFetchTime > CACHE_TTL) await loadMembersForce();
    return cachedMembers;
}
async function loadAllUsers() {
    if (cachedUsers.length === 0 || Date.now() - lastFetchTime > CACHE_TTL) await loadUsersForce();
    return cachedUsers;
}

async function loadLoans() {
    const loansSnap = await getDocs(query(loansCol, orderBy("loanDate", "desc")));
    const loans = loansSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (loans.length === 0) return [];
    const bookIds = [...new Set(loans.map(l => l.bookId).filter(Boolean))];
    const memberIds = [...new Set(loans.map(l => l.memberId).filter(Boolean))];
    const [booksMap, membersMap] = await Promise.all([
        (async () => {
            const map = new Map();
            const snap = await Promise.all(bookIds.map(id => getDoc(doc(booksCol, id))));
            snap.forEach(ds => { if (ds.exists()) map.set(ds.id, ds.data()); });
            return map;
        })(),
        (async () => {
            const map = new Map();
            const snap = await Promise.all(memberIds.map(id => getDoc(doc(membersCol, id))));
            snap.forEach(ds => { if (ds.exists()) map.set(ds.id, ds.data()); });
            return map;
        })()
    ]);
    return loans.map(loan => ({
        ...loan,
        bookTitle: booksMap.get(loan.bookId)?.title || "-",
        bookCover: booksMap.get(loan.bookId)?.cover || "📖",
        memberName: membersMap.get(loan.memberId)?.name || "-"
    }));
}

async function loadReturns() {
    const returnsSnap = await getDocs(query(returnsCol, orderBy("returnDate", "desc")));
    const returns = returnsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (returns.length === 0) return [];
    const loanIds = [...new Set(returns.map(r => r.loanId))];
    const loansMap = new Map();
    const loanDocs = await Promise.all(loanIds.map(id => getDoc(doc(loansCol, id))));
    loanDocs.forEach(ds => { if (ds.exists()) loansMap.set(ds.id, ds.data()); });
    const bookIds = [...new Set([...loansMap.values()].map(loan => loan.bookId))];
    const memberIds = [...new Set([...loansMap.values()].map(loan => loan.memberId))];
    const [booksMap, membersMap] = await Promise.all([
        (async () => {
            const map = new Map();
            const snap = await Promise.all(bookIds.map(id => getDoc(doc(booksCol, id))));
            snap.forEach(ds => { if (ds.exists()) map.set(ds.id, ds.data()); });
            return map;
        })(),
        (async () => {
            const map = new Map();
            const snap = await Promise.all(memberIds.map(id => getDoc(doc(membersCol, id))));
            snap.forEach(ds => { if (ds.exists()) map.set(ds.id, ds.data()); });
            return map;
        })()
    ]);
    return returns.map(ret => {
        const loan = loansMap.get(ret.loanId);
        if (!loan) return { ...ret, bookTitle: "-", memberName: "-", loanDate: "-", dueDate: "-" };
        return {
            ...ret,
            bookTitle: booksMap.get(loan.bookId)?.title || "-",
            memberName: membersMap.get(loan.memberId)?.name || "-",
            loanDate: loan.loanDate,
            dueDate: loan.dueDate
        };
    });
}

// Seed data awal
async function seedInitialData() {
    try {
        const adminQuery = query(usersCol, where("username", "==", "admin"));
        if ((await getDocs(adminQuery)).empty) {
            await addDoc(usersCol, { username: "admin", password: "admin123", role: "admin", memberId: null });
        }
        if ((await getDocs(booksCol)).empty) {
            await addDoc(booksCol, { title: "Pemrograman Web Modern", publisher: "Gramedia", totalStock: 5, availableStock: 5, cover: "📘" });
            await addDoc(booksCol, { title: "Database Sistem", publisher: "Informatika", totalStock: 3, availableStock: 3, cover: "📗" });
            await addDoc(booksCol, { title: "UI/UX Design", publisher: "Andi Offset", totalStock: 4, availableStock: 4, cover: "🎨" });
        }
        if ((await getDocs(membersCol)).empty) {
            const m1 = await addDoc(membersCol, { name: "Ahmad Rizki", className: "XI RPL 1", phone: "08123456789", registerDate: new Date().toISOString() });
            const m2 = await addDoc(membersCol, { name: "Dewi Lestari", className: "XII RPL 2", phone: "08234567890", registerDate: new Date().toISOString() });
            await addDoc(usersCol, { username: "ahmad", password: "ahmad123", role: "member", memberId: m1.id });
            await addDoc(usersCol, { username: "dewi", password: "dewi123", role: "member", memberId: m2.id });
        }
    } catch(e) { console.error(e); }
}
seedInitialData();

// Toggle password visibility
function setupPasswordToggle(toggleId, inputId) {
    const toggle = document.getElementById(toggleId);
    const input = document.getElementById(inputId);
    if (toggle && input) {
        toggle.classList.add('fa-eye-slash');
        toggle.addEventListener('click', () => {
            const type = input.getAttribute('type');
            if (type === 'password') {
                input.setAttribute('type', 'text');
                toggle.classList.remove('fa-eye-slash');
                toggle.classList.add('fa-eye');
            } else {
                input.setAttribute('type', 'password');
                toggle.classList.remove('fa-eye');
                toggle.classList.add('fa-eye-slash');
            }
        });
    }
}

// Login & Register
async function handleLogin(username, password) {
    if (!username || !password) { showToast("Isi username dan password", "error"); return false; }
    try {
        const q = query(usersCol, where("username", "==", username), where("password", "==", password));
        const snap = await getDocs(q);
        if (snap.empty) { showToast("Login gagal", "error"); return false; }
        currentUser = { id: snap.docs[0].id, ...snap.docs[0].data() };
        localStorage.setItem("perpustakaan_user", JSON.stringify({ id: currentUser.id, username: currentUser.username, role: currentUser.role, memberId: currentUser.memberId }));
        showToast(`Selamat datang ${currentUser.username}`);
        renderDashboard();
        return true;
    } catch(e) { showToast("Error", "error"); return false; }
}

async function handleRegister(name, className, phone, username, password) {
    if (!name || !className || !username || !password) { showToast("Semua field harus diisi", "error"); return false; }
    try {
        const existing = await getDocs(query(usersCol, where("username", "==", username)));
        if (!existing.empty) { showToast("Username sudah dipakai", "error"); return false; }
        const memberRef = await addDoc(membersCol, { name, className, phone, registerDate: new Date().toISOString() });
        await addDoc(usersCol, { username, password, role: "member", memberId: memberRef.id });
        showToast("Registrasi berhasil, silakan login");
        return true;
    } catch(e) { showToast("Gagal registrasi", "error"); return false; }
}

// Modal
function openModal(title, bodyHtml, onConfirm) {
    document.getElementById("modalTitle").innerText = title;
    document.getElementById("modalBody").innerHTML = bodyHtml;
    document.getElementById("modalForm").classList.remove("hidden");
    modalCallback = onConfirm;
    setTimeout(() => {
        const modalPwdToggle = document.querySelector('#modalForm .password-toggle');
        if (modalPwdToggle) {
            const input = modalPwdToggle.parentElement.querySelector('input');
            modalPwdToggle.classList.add('fa-eye-slash');
            modalPwdToggle.addEventListener('click', () => {
                const type = input.getAttribute('type');
                if (type === 'password') {
                    input.setAttribute('type', 'text');
                    modalPwdToggle.classList.remove('fa-eye-slash');
                    modalPwdToggle.classList.add('fa-eye');
                } else {
                    input.setAttribute('type', 'password');
                    modalPwdToggle.classList.remove('fa-eye');
                    modalPwdToggle.classList.add('fa-eye-slash');
                }
            });
        }
    }, 100);
}
function closeModal() {
    document.getElementById("modalForm").classList.add("hidden");
    modalCallback = null;
}

// Render Dashboard utama
async function renderDashboard() {
    document.getElementById("authSection").classList.add("hidden");
    document.getElementById("dashboardSection").classList.remove("hidden");
    document.getElementById("userNameDisplay").innerText = currentUser.username;
    document.getElementById("userRoleBadge").innerHTML = currentUser.role === 'admin' ? '<i class="fas fa-shield-alt"></i> Admin' : '<i class="fas fa-user-graduate"></i> Anggota';
    const navTabs = document.getElementById("navTabs");
    navTabs.innerHTML = "";
    if (currentUser.role === 'admin') {
        const menus = [
            { id: "adminBooks", label: "📚 Buku", icon: "fa-book" },
            { id: "adminMembers", label: "👥 Anggota", icon: "fa-users" },
            { id: "adminLoans", label: "📋 Peminjaman", icon: "fa-hand-holding" },
            { id: "adminReturns", label: "🔄 Pengembalian", icon: "fa-undo-alt" },
            { id: "adminFines", label: "💰 Denda Belum Lunas", icon: "fa-coins" }
        ];
        menus.forEach(menu => {
            const btn = document.createElement("button");
            btn.className = "px-4 py-2 rounded-full bg-white/30 hover:bg-white/50 text-pink-800 font-medium transition flex items-center gap-2 backdrop-blur-sm";
            btn.innerHTML = `<i class="fas ${menu.icon}"></i> ${menu.label}`;
            btn.onclick = () => renderAdminContent(menu.id);
            navTabs.appendChild(btn);
        });
        renderAdminContent("adminBooks");
    } else {
        const menus = [
            { id: "userBorrow", label: "📖 Pinjam Buku", icon: "fa-hand-holding-heart" },
            { id: "userLoans", label: "📌 Peminjaman Saya", icon: "fa-list" },
            { id: "userReturn", label: "🔄 Kembalikan Buku", icon: "fa-undo" },
            { id: "userFines", label: "💰 Denda Saya", icon: "fa-coins" }
        ];
        menus.forEach(menu => {
            const btn = document.createElement("button");
            btn.className = "px-4 py-2 rounded-full bg-white/30 hover:bg-white/50 text-pink-800 font-medium transition flex items-center gap-2 backdrop-blur-sm";
            btn.innerHTML = `<i class="fas ${menu.icon}"></i> ${menu.label}`;
            btn.onclick = () => renderUserContent(menu.id);
            navTabs.appendChild(btn);
        });
        renderUserContent("userBorrow");
    }
}

// ==================== ADMIN ====================
async function renderAdminContent(section) {
    const container = document.getElementById("contentPanel");
    if (section === "adminBooks") await renderAdminBooks(container);
    else if (section === "adminMembers") await renderAdminMembers(container);
    else if (section === "adminLoans") await renderAdminLoans(container);
    else if (section === "adminReturns") await renderAdminReturns(container);
    else if (section === "adminFines") await renderAdminFines(container);
}

async function renderAdminBooks(container) {
    let books = await loadBooksForce();
    container.innerHTML = `<div class="flex justify-between items-center mb-4"><h2 class="text-2xl font-bold text-pink-700"><i class="fas fa-book text-pink-500"></i> Manajemen Buku</h2><button id="addBookBtn" class="bg-pink-500 text-white px-4 py-2 rounded-xl shadow"><i class="fas fa-plus"></i> Tambah Buku</button></div><div class="overflow-x-auto"><table class="w-full table-modern bg-white/70 rounded-xl"><thead class="bg-pink-50"><tr><th>Cover</th><th>Judul</th><th>Penerbit</th><th>Stok Total</th><th>Stok Tersedia</th><th>Aksi</th></tr></thead><tbody id="booksTableBody"></tbody></table></div>`;
    const renderTable = () => {
        document.getElementById("booksTableBody").innerHTML = books.map(b => `<tr><td class="text-3xl text-center">${b.cover || '📖'}</td><td class="font-medium">${b.title}</td><td class="font-medium">${b.publisher || '-'}</td><td class="font-medium">${b.totalStock}</td><td class="font-medium">${b.availableStock}</td><td class="font-medium"><button data-id="${b.id}" class="editBookBtn text-pink-600 mr-2"><i class="fas fa-edit"></i></button><button data-id="${b.id}" class="deleteBookBtn text-red-500"><i class="fas fa-trash"></i></button></td></tr>`).join('');
        document.querySelectorAll(".editBookBtn").forEach(btn => btn.onclick = () => editBook(btn.dataset.id));
        document.querySelectorAll(".deleteBookBtn").forEach(btn => btn.onclick = () => deleteBook(btn.dataset.id));
    };
    renderTable();
    document.getElementById("addBookBtn").onclick = () => {
        openModal("Tambah Buku", `<div class="mb-3"><label>Cover (emoji)</label><input id="bookCover" class="w-full border rounded p-2" value="📚"></div><div class="mb-3"><label>Judul</label><input id="bookTitle" class="w-full border rounded p-2"></div><div class="mb-3"><label>Penerbit</label><input id="bookPublisher" class="w-full border rounded p-2"></div><div class="mb-3"><label>Stok Total</label><input id="bookStock" type="number" class="w-full border rounded p-2"></div>`, async () => {
            const cover = document.getElementById("bookCover").value;
            const title = document.getElementById("bookTitle").value;
            const publisher = document.getElementById("bookPublisher").value;
            const totalStock = parseInt(document.getElementById("bookStock").value);
            if (!title || isNaN(totalStock)) { showToast("Data tidak lengkap", "error"); return; }
            await addDoc(booksCol, { title, publisher, totalStock, availableStock: totalStock, cover });
            showToast("Buku ditambahkan");
            books = await loadBooksForce();
            renderTable();
        });
    };
    window.editBook = async (id) => {
        const ref = doc(booksCol, id);
        const data = (await getDoc(ref)).data();
        openModal("Edit Buku", `<div class="mb-3"><label>Cover</label><input id="bookCover" class="w-full border rounded p-2" value="${data.cover || '📚'}"></div><div class="mb-3"><label>Judul</label><input id="bookTitle" class="w-full border rounded p-2" value="${data.title}"></div><div class="mb-3"><label>Penerbit</label><input id="bookPublisher" class="w-full border rounded p-2" value="${data.publisher || ''}"></div><div class="mb-3"><label>Stok Total</label><input id="bookStock" type="number" class="w-full border rounded p-2" value="${data.totalStock}"></div>`, async () => {
            const newCover = document.getElementById("bookCover").value;
            const newTitle = document.getElementById("bookTitle").value;
            const newPub = document.getElementById("bookPublisher").value;
            const newTotal = parseInt(document.getElementById("bookStock").value);
            if (!newTitle || isNaN(newTotal)) return;
            const diff = newTotal - data.totalStock;
            await updateDoc(ref, { cover: newCover, title: newTitle, publisher: newPub, totalStock: newTotal, availableStock: data.availableStock + diff });
            showToast("Buku diupdate");
            books = await loadBooksForce();
            renderTable();
        });
    };
    window.deleteBook = async (id) => {
        if (confirm("Hapus buku?")) {
            await deleteDoc(doc(booksCol, id));
            showToast("Buku dihapus");
            books = await loadBooksForce();
            renderTable();
        }
    };
}

async function renderAdminMembers(container) {
    let members = await loadMembersForce();
    let users = await loadUsersForce();
    let loans = await loadLoans();
    const activeLoansCount = new Map();
    loans.forEach(loan => {
        if (loan.status === 'borrowed') {
            activeLoansCount.set(loan.memberId, (activeLoansCount.get(loan.memberId) || 0) + 1);
        }
    });
    const userMap = new Map();
    users.forEach(u => { if (u.memberId) userMap.set(u.memberId, u); });
    container.innerHTML = `<div class="flex justify-between items-center mb-4"><h2 class="text-2xl font-bold text-pink-700"><i class="fas fa-users text-pink-500"></i> Manajemen Anggota</h2><button id="addMemberBtn" class="bg-pink-500 text-white px-4 py-2 rounded-xl shadow"><i class="fas fa-user-plus"></i> Tambah Anggota</button></div>
    <div class="overflow-x-auto"><table class="w-full table-modern bg-white/70 rounded-xl"><thead class="bg-pink-50"><tr><th>Nama</th><th>Kelas</th><th>Telepon</th><th>Tgl Daftar</th><th>Username</th><th>Password</th><th>Status Peminjaman</th><th>Aksi</th></tr></thead><tbody id="membersTableBody"></tbody></table></div>`;
    const renderTable = () => {
        document.getElementById("membersTableBody").innerHTML = members.map(m => {
            const user = userMap.get(m.id);
            const username = user ? user.username : '-';
            const password = user ? user.password : '-';
            const rowId = `row-${m.id}`;
            const activeCount = activeLoansCount.get(m.id) || 0;
            const statusBadge = activeCount > 0 ? `<span class="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs">${activeCount} buku dipinjam</span>` : `<span class="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs">Tidak ada pinjaman</span>`;
            return `<tr id="${rowId}">
                <td class="font-medium">${m.name}</td>
                <td class="font-medium">${m.className}</td>
                <td class="font-medium">${m.phone}</td>
                <td class="font-medium">${formatDate(m.registerDate)}</td>
                <td class="font-medium">${username}</td>
                <td class="relative-field"><span class="password-display" data-pwd="${password}">••••••</span><i class="fas fa-eye-slash password-toggle-inline ml-2" data-row="${rowId}"></i></td>
                <td class="font-medium text-center">${statusBadge}</td>
                <td class="font-medium"><button data-id="${m.id}" class="editMemberBtn text-pink-600 mr-2"><i class="fas fa-edit"></i></button><button data-id="${m.id}" class="deleteMemberBtn text-red-500"><i class="fas fa-trash"></i></button></td>
             </tr>`;
        }).join('');
        document.querySelectorAll('.password-toggle-inline').forEach(icon => {
            icon.addEventListener('click', (e) => {
                const rowId = icon.getAttribute('data-row');
                const row = document.getElementById(rowId);
                const span = row.querySelector('.password-display');
                if (span.innerText === '••••••') {
                    span.innerText = span.getAttribute('data-pwd');
                    icon.classList.remove('fa-eye-slash');
                    icon.classList.add('fa-eye');
                } else {
                    span.innerText = '••••••';
                    icon.classList.remove('fa-eye');
                    icon.classList.add('fa-eye-slash');
                }
            });
        });
        document.querySelectorAll(".editMemberBtn").forEach(btn => btn.onclick = () => editMember(btn.dataset.id));
        document.querySelectorAll(".deleteMemberBtn").forEach(btn => btn.onclick = () => deleteMember(btn.dataset.id));
    };
    renderTable();
    document.getElementById("addMemberBtn").onclick = () => {
        openModal("Tambah Anggota", `<div class="mb-3"><label>Nama</label><input id="memberName" class="w-full border rounded p-2"></div><div class="mb-3"><label>Kelas</label><input id="memberClass" class="w-full border rounded p-2"></div><div class="mb-3"><label>Telepon</label><input id="memberPhone" class="w-full border rounded p-2"></div><div class="mb-3"><label>Username</label><input id="memberUsername" class="w-full border rounded p-2"></div><div class="mb-3 relative-field"><label>Password</label><input id="memberPassword" type="password" class="w-full border rounded p-2 pr-8"><i class="fas fa-eye-slash password-toggle absolute right-3 top-9"></i></div>`, async () => {
            const name = document.getElementById("memberName").value;
            const className = document.getElementById("memberClass").value;
            const phone = document.getElementById("memberPhone").value;
            const username = document.getElementById("memberUsername").value;
            const password = document.getElementById("memberPassword").value;
            if (!name || !className || !username || !password) { showToast("Isi semua", "error"); return; }
            const existing = await getDocs(query(usersCol, where("username", "==", username)));
            if (!existing.empty) { showToast("Username sudah ada", "error"); return; }
            const memberRef = await addDoc(membersCol, { name, className, phone, registerDate: new Date().toISOString() });
            await addDoc(usersCol, { username, password, role: "member", memberId: memberRef.id });
            showToast("Anggota dan akun dibuat");
            members = await loadMembersForce();
            users = await loadUsersForce();
            userMap.clear();
            users.forEach(u => { if (u.memberId) userMap.set(u.memberId, u); });
            renderTable();
        });
    };
    window.editMember = async (id) => {
        const ref = doc(membersCol, id);
        const data = (await getDoc(ref)).data();
        const userQuery = query(usersCol, where("memberId", "==", id));
        const userSnap = await getDocs(userQuery);
        let username = '', password = '';
        if (!userSnap.empty) { username = userSnap.docs[0].data().username; password = userSnap.docs[0].data().password; }
        openModal("Edit Anggota", `<div class="mb-3"><label>Nama</label><input id="memberName" class="w-full border rounded p-2" value="${data.name}"></div><div class="mb-3"><label>Kelas</label><input id="memberClass" class="w-full border rounded p-2" value="${data.className}"></div><div class="mb-3"><label>Telepon</label><input id="memberPhone" class="w-full border rounded p-2" value="${data.phone}"></div><div class="mb-3"><label>Username</label><input id="memberUsername" class="w-full border rounded p-2" value="${username}"></div><div class="mb-3 relative-field"><label>Password</label><input id="memberPassword" type="password" class="w-full border rounded p-2 pr-8" value="${password}"><i class="fas fa-eye-slash password-toggle absolute right-3 top-9"></i></div>`, async () => {
            const newName = document.getElementById("memberName").value;
            const newClass = document.getElementById("memberClass").value;
            const newPhone = document.getElementById("memberPhone").value;
            const newUsername = document.getElementById("memberUsername").value;
            const newPassword = document.getElementById("memberPassword").value;
            if (!newName) return;
            await updateDoc(ref, { name: newName, className: newClass, phone: newPhone });
            if (!userSnap.empty) await updateDoc(doc(usersCol, userSnap.docs[0].id), { username: newUsername, password: newPassword });
            showToast("Anggota diperbarui");
            members = await loadMembersForce();
            users = await loadUsersForce();
            userMap.clear();
            users.forEach(u => { if (u.memberId) userMap.set(u.memberId, u); });
            renderTable();
        });
    };
    window.deleteMember = async (id) => {
        if (confirm("Hapus anggota?")) {
            const userQuery = query(usersCol, where("memberId", "==", id));
            const userSnap = await getDocs(userQuery);
            if (!userSnap.empty) await deleteDoc(doc(usersCol, userSnap.docs[0].id));
            await deleteDoc(doc(membersCol, id));
            showToast("Anggota dihapus");
            members = await loadMembersForce();
            users = await loadUsersForce();
            userMap.clear();
            users.forEach(u => { if (u.memberId) userMap.set(u.memberId, u); });
            renderTable();
        }
    };
}

async function renderAdminLoans(container) {
    let loans = await loadLoans();
    const books = await loadBooksForce();
    const members = await loadMembersForce();
    container.innerHTML = `<h2 class="text-2xl font-bold mb-3 text-pink-700"><i class="fas fa-hand-holding text-pink-500"></i> Data Peminjaman</h2><button id="newLoanBtn" class="bg-pink-500 text-white px-4 py-2 rounded-xl shadow mb-4"><i class="fas fa-plus"></i> Peminjaman Baru</button><div class="overflow-x-auto"><table class="w-full table-modern bg-white/70 rounded-xl"><thead class="bg-pink-50"><tr><th>Cover</th><th>Peminjam</th><th>Buku</th><th>Tgl Pinjam</th><th>Jatuh Tempo</th><th>Status</th><th>Aksi</th></tr></thead><tbody id="loansTableBody"></tbody></table></div>`;
    const renderTable = () => {
        document.getElementById("loansTableBody").innerHTML = loans.map(l => {
            const overdue = l.status === 'borrowed' && isOverdue(l.dueDate);
            const statusText = l.status === 'returned' ? 'Dikembalikan' : (overdue ? 'Terlambat' : 'Dipinjam');
            const statusClass = l.status === 'returned' ? 'bg-green-100 text-green-700' : (overdue ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700');
            return `<tr><td class="text-2xl">${l.bookCover}</td><td class="font-medium">${l.memberName}</td><td class="font-medium">${l.bookTitle}</td><td class="font-medium">${formatDate(l.loanDate)}</td><td class="font-medium">${formatDate(l.dueDate)}</td><td class="font-medium"><span class="px-2 py-1 rounded-full text-xs ${statusClass}">${statusText}</span></td><td class="font-medium">${l.status === 'borrowed' ? `<button data-id="${l.id}" class="extendLoanBtn bg-pink-400 text-white px-2 py-1 rounded mr-1"><i class="fas fa-calendar-plus"></i> Perpanjang</button><button data-id="${l.id}" class="returnLoanBtn bg-pink-600 text-white px-2 py-1 rounded mr-1">Kembalikan</button><button data-id="${l.id}" class="deleteLoanBtn bg-red-500 text-white px-2 py-1 rounded">Hapus</button>` : `<button data-id="${l.id}" class="deleteLoanBtn bg-red-500 text-white px-2 py-1 rounded">Hapus</button>`}</td></tr>`;
        }).join('');
        document.querySelectorAll(".returnLoanBtn").forEach(btn => btn.onclick = () => processReturn(btn.dataset.id));
        document.querySelectorAll(".extendLoanBtn").forEach(btn => btn.onclick = () => openExtendModal(btn.dataset.id));
        document.querySelectorAll(".deleteLoanBtn").forEach(btn => btn.onclick = () => deleteLoan(btn.dataset.id));
    };
    renderTable();
    document.getElementById("newLoanBtn").onclick = () => {
        openModal("Peminjaman Baru", `<div class="mb-3"><label>Anggota</label><select id="loanMember" class="w-full border rounded p-2">${members.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}</select></div><div class="mb-3"><label>Buku</label><select id="loanBook" class="w-full border rounded p-2">${books.map(b => `<option value="${b.id}">${b.cover} ${b.title} (Stok:${b.availableStock})</option>`).join('')}</select></div>`, async () => {
            const memberId = document.getElementById("loanMember").value;
            const bookId = document.getElementById("loanBook").value;
            const bookRef = doc(booksCol, bookId);
            const bookSnap = await getDoc(bookRef);
            if (bookSnap.data().availableStock <= 0) { showToast("Stok habis", "error"); return; }
            const loanDate = new Date().toISOString();
            const dueDate = getDueDate(loanDate);
            await addDoc(loansCol, { bookId, memberId, loanDate, dueDate, status: "borrowed" });
            await updateDoc(bookRef, { availableStock: bookSnap.data().availableStock - 1 });
            showToast("Peminjaman berhasil");
            loans = await loadLoans();
            renderTable();
        });
    };
    window.openExtendModal = (loanId) => {
        openModal("Perpanjang Jatuh Tempo", `<div class="mb-3"><label>Tanggal Baru</label><input type="date" id="newDueDate" class="w-full border rounded p-2" value="${new Date().toISOString().slice(0,10)}"></div>`, async () => {
            const newDateStr = document.getElementById("newDueDate").value;
            if (!newDateStr) return;
            const newDue = new Date(newDateStr);
            if (isNaN(newDue.getTime())) return;
            const loanRef = doc(loansCol, loanId);
            const loanSnap = await getDoc(loanRef);
            if (!loanSnap.exists() || loanSnap.data().status !== 'borrowed') { showToast("Tidak bisa perpanjang", "error"); return; }
            await updateDoc(loanRef, { dueDate: newDue.toISOString() });
            showToast(`Jatuh tempo menjadi ${formatDate(newDue)}`);
            loans = await loadLoans();
            renderTable();
        });
    };
    window.processReturn = async (loanId) => {
        const loanRef = doc(loansCol, loanId);
        const loan = await getDoc(loanRef);
        if (!loan.exists() || loan.data().status === 'returned') return;
        const loanData = loan.data();
        const returnDate = new Date().toISOString();
        const lateFee = calculateLateFee(loanData.dueDate, returnDate);
        await addDoc(returnsCol, { loanId, returnDate, lateFee, finePaid: false, paymentProof: null });
        await updateDoc(loanRef, { status: "returned", returnDate });
        const bookRef = doc(booksCol, loanData.bookId);
        const bookSnap = await getDoc(bookRef);
        if (bookSnap.exists()) await updateDoc(bookRef, { availableStock: bookSnap.data().availableStock + 1 });
        if (lateFee > 0) showToast(`Buku dikembalikan. Denda Rp${lateFee.toLocaleString()}. Bayar di menu Denda Saya.`);
        else showToast("Pengembalian berhasil (tepat waktu)");
        loans = await loadLoans();
        renderTable();
    };
    window.deleteLoan = async (loanId) => {
        if (!confirm("Yakin hapus peminjaman?")) return;
        const loanRef = doc(loansCol, loanId);
        const loanSnap = await getDoc(loanRef);
        if (!loanSnap.exists()) return;
        const loanData = loanSnap.data();
        if (loanData.status === 'borrowed') {
            const bookRef = doc(booksCol, loanData.bookId);
            const bookSnap = await getDoc(bookRef);
            if (bookSnap.exists()) await updateDoc(bookRef, { availableStock: bookSnap.data().availableStock + 1 });
        }
        const returnsQuery = query(returnsCol, where("loanId", "==", loanId));
        const returnsSnap = await getDocs(returnsQuery);
        for (const retDoc of returnsSnap.docs) await deleteDoc(doc(returnsCol, retDoc.id));
        await deleteDoc(loanRef);
        showToast("Peminjaman dihapus");
        loans = await loadLoans();
        renderTable();
    };
}

async function renderAdminReturns(container) {
    let returns = await loadReturns();
    container.innerHTML = `<h2 class="text-2xl font-bold mb-3 text-pink-700"><i class="fas fa-undo-alt text-pink-500"></i> Data Pengembalian</h2><div class="overflow-x-auto"><table class="w-full table-modern bg-white/70 rounded-xl"><thead class="bg-pink-50"><tr><th>Peminjam</th><th>Buku</th><th>Tgl Pinjam</th><th>Jatuh Tempo</th><th>Tgl Kembali</th><th>Denda</th><th>Status Bayar</th></tr></thead><tbody>${returns.map(r => {
        const fineColor = r.lateFee > 0 ? 'text-red-600' : 'text-pink-500';
        const paidStatus = r.finePaid ? 'Lunas' : (r.lateFee > 0 ? 'Belum Lunas' : '-');
        return `<tr><td class="font-medium">${r.memberName}</td><td class="font-medium">${r.bookTitle}</td><td class="font-medium">${formatDate(r.loanDate)}</td><td class="font-medium">${formatDate(r.dueDate)}</td><td class="font-medium">${formatDate(r.returnDate)}</td><td class="${fineColor}">Rp${(r.lateFee || 0).toLocaleString()}</td><td class="font-medium">${paidStatus}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

async function renderAdminFines(container) {
    let returns = await loadReturns();
    const unpaid = returns.filter(r => r.lateFee > 0 && !r.finePaid);
    container.innerHTML = `<h2 class="text-2xl font-bold mb-3 text-pink-700"><i class="fas fa-coins text-pink-500"></i> Denda Belum Lunas</h2><div class="overflow-x-auto"><table class="w-full table-modern bg-white/70 rounded-xl"><thead class="bg-pink-50"><tr><th>Peminjam</th><th>Buku</th><th>Jatuh Tempo</th><th>Tgl Kembali</th><th>Denda</th><th>Bukti</th><th>Aksi</th></tr></thead><tbody>${unpaid.map(r => {
        let proofHtml = '-';
        if (r.paymentProof) proofHtml = `<a href="${r.paymentProof}" target="_blank" class="text-blue-500"><i class="fas fa-image"></i> Lihat</a>`;
        return `<tr><td class="font-medium">${r.memberName}</td><td class="font-medium">${r.bookTitle}</td><td class="font-medium">${formatDate(r.dueDate)}</td><td class="font-medium">${formatDate(r.returnDate)}</td><td class="text-red-600">Rp${r.lateFee.toLocaleString()}</td><td class="font-medium">${proofHtml}</td><td class="font-medium"><button data-id="${r.id}" class="markPaidBtn bg-green-500 text-white px-2 py-1 rounded">Tandai Lunas</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
    setTimeout(() => {
        document.querySelectorAll(".markPaidBtn").forEach(btn => btn.onclick = async () => {
            const returnId = btn.dataset.id;
            await updateDoc(doc(returnsCol, returnId), { finePaid: true });
            showToast("Denda ditandai lunas");
            renderAdminFines(container);
        });
    }, 100);
}

// ==================== USER ====================
async function renderUserContent(section) {
    const container = document.getElementById("contentPanel");
    if (section === "userBorrow") await renderUserBorrow(container);
    else if (section === "userLoans") await renderUserLoans(container);
    else if (section === "userReturn") await renderUserReturn(container);
    else if (section === "userFines") await renderUserFines(container);
}

async function renderUserBorrow(container) {
    if (!currentUser.memberId) { container.innerHTML = `<div class="bg-red-100 p-4 rounded-xl">Akun tidak valid</div>`; return; }
    let books = await loadBooksForce();
    container.innerHTML = `<h2 class="text-2xl font-bold mb-3 text-pink-700"><i class="fas fa-book-open text-pink-500"></i> Peminjaman Buku</h2><input id="searchBookUser" placeholder="Cari judul..." class="border p-2 rounded w-full md:w-64 mb-4"><div id="bookListUser" class="grid md:grid-cols-2 lg:grid-cols-3 gap-4"></div>`;
    const render = (bk) => {
        document.getElementById("bookListUser").innerHTML = bk.map(b => `<div class="bg-white/80 p-4 rounded-2xl shadow text-center"><div class="text-5xl">${b.cover}</div><h3 class="font-bold">${b.title}</h3><p>${b.publisher}</p><p>Tersedia: ${b.availableStock}</p>${b.availableStock > 0 ? `<button data-id="${b.id}" class="borrowUserBtn mt-3 w-full bg-pink-500 text-white py-2 rounded-xl">Pinjam</button>` : '<button disabled class="mt-3 w-full bg-gray-300 py-2 rounded-xl">Stok Habis</button>'}</div>`).join('');
        document.querySelectorAll(".borrowUserBtn").forEach(btn => btn.onclick = () => userBorrowBook(btn.dataset.id));
    };
    render(books);
    document.getElementById("searchBookUser").addEventListener("input", (e) => render(books.filter(b => b.title.toLowerCase().includes(e.target.value.toLowerCase()))));
    window.userBorrowBook = async (bookId) => {
        const bookRef = doc(booksCol, bookId);
        const book = await getDoc(bookRef);
        if (book.data().availableStock <= 0) return showToast("Stok habis", "error");
        const existing = await getDocs(query(loansCol, where("memberId", "==", currentUser.memberId), where("bookId", "==", bookId), where("status", "==", "borrowed")));
        if (!existing.empty) return showToast("Anda masih meminjam buku ini", "error");
        const loanDate = new Date().toISOString();
        const dueDate = getDueDate(loanDate);
        await addDoc(loansCol, { bookId, memberId: currentUser.memberId, loanDate, dueDate, status: "borrowed" });
        await updateDoc(bookRef, { availableStock: book.data().availableStock - 1 });
        showToast(`Buku dipinjam, jatuh tempo ${formatDate(dueDate)}`);
        renderUserBorrow(container);
    };
}

async function renderUserLoans(container) {
    if (!currentUser.memberId) return;
    let all = await loadLoans();
    const myLoans = all.filter(l => l.memberId === currentUser.memberId);
    container.innerHTML = `<h2 class="text-2xl font-bold mb-3 text-pink-700">Peminjaman Saya</h2><div class="overflow-x-auto"><table class="w-full table-modern bg-white/70 rounded-xl"><thead class="bg-pink-50"><tr><th>Cover</th><th>Buku</th><th>Tgl Pinjam</th><th>Jatuh Tempo</th><th>Status</th></tr></thead><tbody>${myLoans.map(l => {
        const overdue = l.status === 'borrowed' && isOverdue(l.dueDate);
        const status = l.status === 'returned' ? 'Dikembalikan' : (overdue ? 'Terlambat' : 'Dipinjam');
        return `<tr><td class="text-2xl">${l.bookCover}</td><td class="font-medium">${l.bookTitle}</td><td class="font-medium">${formatDate(l.loanDate)}</td><td class="font-medium">${formatDate(l.dueDate)}</td><td class="font-medium">${status}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

async function renderUserReturn(container) {
    if (!currentUser.memberId) return;
    let all = await loadLoans();
    const active = all.filter(l => l.memberId === currentUser.memberId && l.status === "borrowed");
    container.innerHTML = `<h2 class="text-2xl font-bold mb-3 text-pink-700">Kembalikan Buku</h2><div class="grid gap-3">${active.length === 0 ? '<div class="bg-white/50 p-4 rounded-xl">Tidak ada buku yang dipinjam</div>' : active.map(l => `<div class="bg-white/80 p-4 rounded-xl flex justify-between items-center"><div><div class="text-2xl inline-block mr-2">${l.bookCover}</div><b>${l.bookTitle}</b><br><small>Jatuh tempo: ${formatDate(l.dueDate)}</small></div><button data-id="${l.id}" class="returnUserBtn bg-pink-500 text-white px-4 py-2 rounded-xl">Kembalikan</button></div>`).join('')}</div>`;
    document.querySelectorAll(".returnUserBtn").forEach(btn => btn.onclick = async () => {
        const loanId = btn.dataset.id;
        const loanRef = doc(loansCol, loanId);
        const loan = await getDoc(loanRef);
        if (loan.data().status === 'returned') return;
        const loanData = loan.data();
        const returnDate = new Date().toISOString();
        const lateFee = calculateLateFee(loanData.dueDate, returnDate);
        await addDoc(returnsCol, { loanId, returnDate, lateFee, finePaid: false, paymentProof: null });
        await updateDoc(loanRef, { status: "returned", returnDate });
        const bookRef = doc(booksCol, loanData.bookId);
        const book = await getDoc(bookRef);
        if (book.exists()) await updateDoc(bookRef, { availableStock: book.data().availableStock + 1 });
        if (lateFee > 0) showToast(`Buku dikembalikan. Denda Rp${lateFee.toLocaleString()}. Bayar di menu Denda Saya.`);
        else showToast("Buku berhasil dikembalikan (tepat waktu)");
        renderUserReturn(container);
    });
}

async function renderUserFines(container) {
    if (!currentUser.memberId) return;
    let allReturns = await loadReturns();
    let allLoansData = await loadLoans();
    const myLoanIds = allLoansData.filter(l => l.memberId === currentUser.memberId).map(l => l.id);
    const myFines = allReturns.filter(r => myLoanIds.includes(r.loanId) && r.lateFee > 0);
    container.innerHTML = `<h2 class="text-2xl font-bold mb-3 text-pink-700"><i class="fas fa-coins text-pink-500"></i> Denda Saya</h2><div class="overflow-x-auto"><table class="w-full table-modern bg-white/70 rounded-xl"><thead class="bg-pink-50"><tr><th>Buku</th><th>Jatuh Tempo</th><th>Tgl Kembali</th><th>Denda</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${myFines.map(r => {
        const paid = r.finePaid ? 'Lunas' : 'Belum Lunas';
        return `<tr><td class="font-medium">${r.bookTitle}</td><td class="font-medium">${formatDate(r.dueDate)}</td><td class="font-medium">${formatDate(r.returnDate)}</td><td class="text-red-600">Rp${r.lateFee.toLocaleString()}</td><td class="font-medium">${paid}</td><td class="font-medium">${!r.finePaid ? `<button data-id="${r.id}" class="payFineBtn bg-green-600 text-white px-2 py-1 rounded">Bayar</button>` : '-'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
    document.querySelectorAll(".payFineBtn").forEach(btn => btn.onclick = () => showPaymentModal(btn.dataset.id));
}

function showPaymentModal(returnId) {
    const modal = document.getElementById("paymentModal");
    const body = document.getElementById("paymentBody");
    body.innerHTML = `<p class="mb-3">Silakan pilih metode pembayaran:</p><div class="flex gap-3 mb-4"><button id="payQris" class="bg-blue-500 text-white px-3 py-2 rounded">QRIS (Scan)</button><button id="payBca" class="bg-blue-500 text-white px-3 py-2 rounded">Transfer BCA</button></div><div id="paymentInstruction"></div><input type="file" id="proofImage" accept="image/*" class="mt-3 w-full"><p class="text-xs text-gray-500 mt-2">Upload bukti pembayaran (foto/ss)</p>`;
    modal.classList.remove("hidden");
    document.getElementById("payQris").onclick = () => {
        document.getElementById("paymentInstruction").innerHTML = `<div class="bg-gray-100 p-3 rounded text-center"><i class="fas fa-qrcode fa-3x"></i><p>Scan QRIS berikut:</p><img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=DummyQRIS" class="mx-auto"><p class="text-xs">QRIS Dummy (demo)</p></div>`;
    };
    document.getElementById("payBca").onclick = () => {
        document.getElementById("paymentInstruction").innerHTML = `<div class="bg-gray-100 p-3 rounded"><p><strong>Bank BCA</strong><br>No. Rekening: 1234567890<br>Atas nama: Perpustakaan Digital</p><p class="text-xs">Transfer sesuai nominal denda</p></div>`;
    };
    document.getElementById("confirmPaymentBtn").onclick = async () => {
        const fileInput = document.getElementById("proofImage");
        if (!fileInput.files.length) { showToast("Harap upload bukti pembayaran", "error"); return; }
        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = async (e) => {
            const proofDataUrl = e.target.result;
            await updateDoc(doc(returnsCol, returnId), { paymentProof: proofDataUrl, finePaid: true });
            showToast("Bukti terkirim, menunggu konfirmasi admin");
            modal.classList.add("hidden");
            renderUserFines(document.getElementById("contentPanel"));
        };
        reader.readAsDataURL(file);
    };
    document.getElementById("closePaymentBtn").onclick = () => modal.classList.add("hidden");
    document.getElementById("cancelPaymentBtn").onclick = () => modal.classList.add("hidden");
}

// Event Listeners & Initialization
document.getElementById("doLoginBtn").onclick = () => handleLogin(document.getElementById("loginUsername").value, document.getElementById("loginPassword").value);
document.getElementById("doRegisterBtn").onclick = () => handleRegister(document.getElementById("regName").value, document.getElementById("regClass").value, document.getElementById("regPhone").value, document.getElementById("regUsername").value, document.getElementById("regPassword").value);
document.getElementById("loginTabBtn").onclick = () => {
    document.getElementById("loginForm").classList.remove("hidden");
    document.getElementById("registerForm").classList.add("hidden");
    document.getElementById("loginTabBtn").classList.add("bg-white","text-pink-600");
    document.getElementById("registerTabBtn").classList.remove("bg-white","text-pink-600");
};
document.getElementById("registerTabBtn").onclick = () => {
    document.getElementById("registerForm").classList.remove("hidden");
    document.getElementById("loginForm").classList.add("hidden");
    document.getElementById("registerTabBtn").classList.add("bg-white","text-pink-600");
    document.getElementById("loginTabBtn").classList.remove("bg-white","text-pink-600");
};
document.getElementById("logoutBtn").onclick = () => {
    localStorage.removeItem("perpustakaan_user");
    currentUser = null;
    document.getElementById("authSection").classList.remove("hidden");
    document.getElementById("dashboardSection").classList.add("hidden");
    showToast("Logout");
};
document.getElementById("closeModalBtn").onclick = closeModal;
document.getElementById("modalCancelBtn").onclick = closeModal;
document.getElementById("modalConfirmBtn").onclick = () => { if (modalCallback) modalCallback(); closeModal(); };

setupPasswordToggle('toggleLoginPassword', 'loginPassword');
setupPasswordToggle('toggleRegPassword', 'regPassword');

// Auto login dari localStorage
const saved = localStorage.getItem("perpustakaan_user");
if (saved) {
    try {
        currentUser = JSON.parse(saved);
        renderDashboard();
    } catch(e) { console.error(e); }
} else {
    document.getElementById("authSection").classList.remove("hidden");
    document.getElementById("dashboardSection").classList.add("hidden");
}