import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as faceapi from '@vladmandic/face-api';
import {
  ArrowDownToLine,
  Bell,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Download,
  Edit3,
  FileSpreadsheet,
  ImagePlus,
  LayoutDashboard,
  ListFilter,
  LogIn,
  LoaderCircle,
  LogOut,
  Moon,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  Trash2,
  UserRound,
  UsersRound,
  Video,
  VideoOff,
  Volume2,
  X,
} from 'lucide-react';
import { supabase, supabaseConfigured } from './lib/supabase.js';

const STORAGE = {
  users: 'ruang-hadir-users-v1',
  logs: 'ruang-hadir-logs-v1',
  theme: 'ruang-hadir-theme-v1',
  cloudMigration: `ruang-hadir-cloud-migration-v1:${import.meta.env.VITE_SUPABASE_URL ?? 'local'}`,
};
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model';
const MATCH_THRESHOLD = 0.52;
const COOLDOWN_MS = 8000;

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timeLabel(date = new Date()) {
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

function distanceBetween(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += (left[index] - right[index]) ** 2;
  return Math.sqrt(total);
}

function compactImage(source, maxDimension = 480) {
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.62);
}

function getBestMatch(descriptor, users) {
  let best = null;
  for (const user of users) {
    for (const sample of user.samples ?? []) {
      if (!sample?.length || sample.length !== descriptor.length) continue;
      const distance = distanceBetween(descriptor, sample);
      if (!best || distance < best.distance) best = { user, distance };
    }
  }
  return best && best.distance <= MATCH_THRESHOLD ? best : null;
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

function downloadCsv(rows) {
  const columns = ['Nama', 'ID', 'Peran / Kelas', 'Tanggal', 'Waktu Absen', 'Status'];
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [columns, ...rows.map((row) => [row.name, row.code, row.role, row.date, row.time, row.status])]
    .map((row) => row.map(escape).join(','))
    .join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  link.download = `laporan-absensi-${todayKey()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function toDatabaseRow(table, row) {
  if (table === 'face_users') return { ...row };
  return {
    id: row.id,
    user_id: row.userId,
    name: row.name,
    code: row.code,
    role: row.role,
    attendance_date: row.date,
    time: row.time,
    status: row.status,
    image: row.image,
  };
}

function fromDatabaseRow(table, row) {
  if (table === 'face_users') return row;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    code: row.code,
    role: row.role,
    date: row.attendance_date,
    time: row.time,
    status: row.status,
    image: row.image,
  };
}

async function syncCloudRows(table, rows, previousRows) {
  const nextRows = new Map(rows.map((row) => [row.id, row]));
  const deletedIds = [...previousRows.current.keys()].filter((id) => !nextRows.has(id));
  const changedRows = rows.filter((row) => JSON.stringify(previousRows.current.get(row.id)) !== JSON.stringify(row));

  if (deletedIds.length) {
    const { error } = await supabase.from(table).delete().in('id', deletedIds);
    if (error) return error;
  }
  if (changedRows.length) {
    const { error } = await supabase.from(table).upsert(changedRows.map((row) => toDatabaseRow(table, row)));
    if (error) return error;
  }
  previousRows.current = nextRows;
  return null;
}

function playSuccessSound() {
  try {
    const context = new window.AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.12, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.24);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.24);
  } catch {
    // Audio is optional when the browser blocks playback.
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance('Absensi berhasil'));
  }
}

function App() {
  const [activeTab, setActiveTab] = useState('live');
  const [users, setUsers] = useState(() => supabaseConfigured ? [] : readStorage(STORAGE.users, []));
  const [logs, setLogs] = useState(() => supabaseConfigured ? [] : readStorage(STORAGE.logs, []));
  const [theme, setTheme] = useState(() => readStorage(STORAGE.theme, 'light'));
  const [authUser, setAuthUser] = useState(null);
  const [authReady, setAuthReady] = useState(!supabaseConfigured);
  const [cloudReady, setCloudReady] = useState(!supabaseConfigured);
  const [cloudError, setCloudError] = useState('');
  const [cloudRetry, setCloudRetry] = useState(0);
  const [syncRetry, setSyncRetry] = useState(0);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authPending, setAuthPending] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [modelState, setModelState] = useState('loading');
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [devices, setDevices] = useState([]);
  const [cameraId, setCameraId] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [now, setNow] = useState(new Date());
  const [recognized, setRecognized] = useState(null);
  const [repeatUserId, setRepeatUserId] = useState(null);
  const [filterDate, setFilterDate] = useState(todayKey());
  const [filterName, setFilterName] = useState('');
  const [selectedAttendanceId, setSelectedAttendanceId] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', code: '', role: '' });
  const [samples, setSamples] = useState([]);
  const [formMessage, setFormMessage] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [pending, setPending] = useState(false);
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const streamRef = useRef(null);
  const usersRef = useRef(users);
  const usersSyncRef = useRef(new Map());
  const logsSyncRef = useRef(new Map());
  const scanBusyRef = useRef(false);
  const cooldownRef = useRef(new Map());
  const lastSeenRef = useRef(new Map());

  useEffect(() => { usersRef.current = users; }, [users]);
  useEffect(() => {
    if (!supabaseConfigured) localStorage.setItem(STORAGE.users, JSON.stringify(users));
  }, [users]);
  useEffect(() => {
    if (!supabaseConfigured) localStorage.setItem(STORAGE.logs, JSON.stringify(logs));
  }, [logs]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE.theme, JSON.stringify(theme));
  }, [theme]);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setAuthError('Sesi Supabase tidak dapat diperiksa. Muat ulang halaman.');
      setAuthUser(data.session?.user ?? null);
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setAuthUser(session?.user ?? null);
      setCloudReady(false);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const loadCloudData = useCallback(async () => {
    if (!supabase || !authUser) return;
    setCloudReady(false);
    setCloudError('');
    const adminResult = await supabase.from('app_admins').select('user_id').eq('user_id', authUser.id).maybeSingle();
    if (adminResult.error || !adminResult.data) {
      setCloudError('Akun ini belum diberi akses admin. Minta administrator menambahkan akun ke daftar admin Supabase.');
      return;
    }
    const [userResult, logResult] = await Promise.all([
      supabase.from('face_users').select('*').order('name'),
      supabase.from('attendance_logs').select('*').order('attendance_date', { ascending: false }).order('time', { ascending: false }),
    ]);
    if (userResult.error || logResult.error) {
      setCloudError('Data Supabase gagal dimuat. Periksa schema.sql dan kebijakan akses RLS.');
      return;
    }
    let loadedUsers = userResult.data.map((row) => fromDatabaseRow('face_users', row));
    let loadedLogs = logResult.data.map((row) => fromDatabaseRow('attendance_logs', row));
    if (localStorage.getItem(STORAGE.cloudMigration) !== 'done') {
      const localUsers = readStorage(STORAGE.users, []);
      const localLogs = readStorage(STORAGE.logs, []);
      if (!loadedUsers.length && localUsers.length) {
        const { error } = await supabase.from('face_users').upsert(localUsers.map((row) => toDatabaseRow('face_users', row)));
        if (error) {
          setCloudError('Migrasi data wajah dari browser gagal. Periksa kapasitas dan kebijakan Supabase.');
          return;
        }
        loadedUsers = localUsers;
      }
      if (!loadedLogs.length && localLogs.length) {
        const { error } = await supabase.from('attendance_logs').upsert(localLogs.map((row) => toDatabaseRow('attendance_logs', row)));
        if (error) {
          setCloudError('Migrasi riwayat absensi dari browser gagal. Periksa kapasitas dan kebijakan Supabase.');
          return;
        }
        loadedLogs = localLogs;
      }
      localStorage.setItem(STORAGE.cloudMigration, 'done');
    }
    usersSyncRef.current = new Map(loadedUsers.map((row) => [row.id, row]));
    logsSyncRef.current = new Map(loadedLogs.map((row) => [row.id, row]));
    setUsers(loadedUsers);
    setLogs(loadedLogs);
    setCloudReady(true);
  }, [authUser]);

  useEffect(() => {
    if (supabaseConfigured && authUser) loadCloudData();
  }, [authUser, cloudRetry, loadCloudData]);

  useEffect(() => {
    if (!supabaseConfigured || !authUser || !cloudReady) return;
    Promise.all([
      syncCloudRows('face_users', users, usersSyncRef),
      syncCloudRows('attendance_logs', logs, logsSyncRef),
    ]).then((errors) => {
      const error = errors.find(Boolean);
      setCloudError(error ? 'Sinkronisasi gagal. Data belum tersimpan; coba sinkronkan ulang.' : '');
    });
  }, [authUser, cloudReady, logs, syncRetry, users]);

  useEffect(() => {
    let mounted = true;
    setModelState('loading');
    Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]).then(() => {
      if (mounted) {
        setModelsReady(true);
        setModelState('ready');
      }
    }).catch(() => {
      if (mounted) setModelState('error');
    });
    return () => { mounted = false; };
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const cameras = all.filter((device) => device.kind === 'videoinput');
    setDevices(cameras);
    if (!cameraId && cameras[0]) setCameraId(cameras[0].deviceId);
  }, [cameraId]);

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
  }, [refreshDevices]);

  useEffect(() => {
    if (!cameraEnabled) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraReady(false);
      return undefined;
    }
    let cancelled = false;
    setCameraError('');
    setCameraReady(false);
    const video = cameraId ? { deviceId: { exact: cameraId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } };
    navigator.mediaDevices?.getUserMedia({ video, audio: false }).then((stream) => {
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setCameraReady(true);
      refreshDevices();
    }).catch((error) => {
      if (!cancelled) {
        setCameraEnabled(false);
        setCameraError(error.name === 'NotAllowedError' ? 'Izin kamera ditolak. Ubah izin kamera di browser untuk melanjutkan.' : 'Kamera tidak dapat dibuka. Periksa koneksi perangkat atau pilih kamera lain.');
      }
    });
    return () => { cancelled = true; };
  }, [cameraEnabled, cameraId, refreshDevices]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    video.srcObject = streamRef.current;
    video.play().catch(() => {});
    setCameraReady(true);
  }, [activeTab]);

  const addAttendance = useCallback((user, snapshot) => {
    const date = todayKey();
    const cooldownKey = `${date}:${user.id}`;
    const current = Date.now();
    if (current - (cooldownRef.current.get(cooldownKey) ?? 0) < COOLDOWN_MS) return;
    cooldownRef.current.set(cooldownKey, current);
    const repeating = repeatUserId === user.id;
    const alreadyPresent = logs.some((log) => log.userId === user.id && log.date === date);
    if (alreadyPresent && !repeating) {
      setRecognized({ user, time: timeLabel(), alreadyPresent: true });
      return;
    }
    const record = {
      id: crypto.randomUUID(),
      userId: user.id,
      name: user.name,
      code: user.code,
      role: user.role,
      time: timeLabel(),
      date,
      status: 'Hadir',
      image: snapshot,
    };
    setLogs((currentLogs) => [record, ...currentLogs.filter((log) => log.userId !== user.id || log.date !== date)]);
    setRecognized({ user, time: record.time, alreadyPresent: false });
    if (repeating) setRepeatUserId(null);
    playSuccessSound();
  }, [logs, repeatUserId]);

  useEffect(() => {
    if (activeTab !== 'live' || !cameraReady || !modelsReady || !scanning || !videoRef.current) return undefined;
    let cancelled = false;
    const scan = async () => {
      const video = videoRef.current;
      const canvas = overlayRef.current;
      if (!video || video.readyState < 2 || scanBusyRef.current) return;
      scanBusyRef.current = true;
      try {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (!width || !height) return;
        const results = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.48 }))
          .withFaceLandmarks()
          .withFaceDescriptors();
        if (cancelled || !canvas) return;
        const display = { width: video.clientWidth, height: video.clientHeight };
        faceapi.matchDimensions(canvas, display);
        const resized = faceapi.resizeResults(results, display);
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, display.width, display.height);
        for (const result of resized) {
          const match = getBestMatch(result.descriptor, usersRef.current);
          const box = result.detection.box;
          context.strokeStyle = match ? '#c9f36a' : 'rgba(255,255,255,.78)';
          context.lineWidth = 2;
          context.strokeRect(box.x, box.y, box.width, box.height);
          if (repeatUserId && match?.user.id !== repeatUserId) continue;
          if (match) {
            context.fillStyle = '#c9f36a';
            context.font = '600 12px Manrope, sans-serif';
            context.fillText(match.user.name, box.x, Math.max(box.y - 8, 16));
            const nowAt = Date.now();
            const previousSeen = lastSeenRef.current.get(match.user.id) ?? 0;
            if (nowAt - previousSeen > 2500) {
              lastSeenRef.current.set(match.user.id, nowAt);
              addAttendance(match.user, compactImage(video));
            }
          }
        }
      } catch {
        // A transient camera frame can fail while the browser switches devices.
      } finally {
        scanBusyRef.current = false;
      }
    };
    const interval = window.setInterval(scan, 700);
    scan();
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [activeTab, addAttendance, cameraReady, modelsReady, repeatUserId, scanning]);

  const todayLogs = useMemo(() => logs.filter((log) => log.date === todayKey()), [logs]);
  const presentCount = new Set(todayLogs.map((log) => log.userId)).size;
  const absentCount = Math.max(users.length - presentCount, 0);
  const filteredLogs = useMemo(() => logs.filter((log) => {
    const matchesDate = !filterDate || log.date === filterDate;
    const matchesName = log.name.toLowerCase().includes(filterName.toLowerCase());
    return matchesDate && matchesName;
  }), [filterDate, filterName, logs]);
  const selectedAttendance = filteredLogs.find((log) => log.id === selectedAttendanceId) ?? filteredLogs[0];
  const visibleUsers = useMemo(() => users.filter((user) => `${user.name} ${user.code} ${user.role}`.toLowerCase().includes(userSearch.toLowerCase())), [userSearch, users]);
  const repeatUser = users.find((user) => user.id === repeatUserId);

  const enableCamera = () => {
    setCameraError('');
    setCameraEnabled(true);
  };

  const repeatAttendance = (log) => {
    if (!log || log.date !== todayKey()) return;
    const user = users.find((item) => item.id === log.userId);
    if (!user) return;
    cooldownRef.current.delete(`${log.date}:${log.userId}`);
    lastSeenRef.current.delete(log.userId);
    setRepeatUserId(user.id);
    setRecognized(null);
    setScanning(true);
    setCameraEnabled(true);
    setActiveTab('live');
  };

  const cancelRepeatAttendance = () => setRepeatUserId(null);

  const deleteAttendance = (log) => {
    if (!log) return;
    if (!window.confirm(`Hapus absensi ${log.name} tanggal ${formatDate(log.date)}?`)) return;
    setLogs((current) => current.filter((item) => item.id !== log.id));
  };

  const deleteAttendanceDay = () => {
    if (!filterDate) return;
    const dayCount = logs.filter((log) => log.date === filterDate).length;
    if (!dayCount || !window.confirm(`Hapus ${dayCount} catatan absensi tanggal ${formatDate(filterDate)}?`)) return;
    setLogs((current) => current.filter((log) => log.date !== filterDate));
  };

  const captureSample = async () => {
    if (!videoRef.current || !modelsReady || !cameraReady) {
      setFormMessage('Aktifkan kamera dan tunggu model pengenalan siap terlebih dahulu.');
      return;
    }
    if (samples.length >= 5) {
      setFormMessage('Maksimal 5 sampel per pengguna.');
      return;
    }
    setPending(true);
    setFormMessage('');
    try {
      const result = await faceapi.detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!result) {
        setFormMessage('Wajah belum terlihat jelas. Atur pencahayaan dan posisikan wajah di tengah.');
        return;
      }
      const video = videoRef.current;
      setSamples((current) => [...current, { descriptor: Array.from(result.descriptor), image: compactImage(video) }]);
      setFormMessage('Sampel wajah berhasil ditambahkan. Coba sedikit ubah sudut wajah untuk sampel berikutnya.');
    } catch {
      setFormMessage('Gagal mengambil sampel. Pastikan kamera masih aktif.');
    } finally {
      setPending(false);
    }
  };

  const uploadSamples = async (event) => {
    const files = Array.from(event.target.files ?? []).slice(0, 5 - samples.length);
    if (!files.length) return;
    setPending(true);
    setFormMessage('Memproses foto dan mencari wajah...');
    try {
      const additions = await Promise.all(files.map(async (file) => {
        const imageData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const image = await faceapi.fetchImage(imageData);
        const result = await faceapi.detectSingleFace(image, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 }))
          .withFaceLandmarks()
          .withFaceDescriptor();
        return result ? { descriptor: Array.from(result.descriptor), image: compactImage(image) } : null;
      }));
      const valid = additions.filter(Boolean);
      setSamples((current) => [...current, ...valid].slice(0, 5));
      setFormMessage(valid.length ? `${valid.length} foto berhasil diproses${valid.length < files.length ? `; ${files.length - valid.length} foto tanpa wajah dilewati` : ''}.` : 'Tidak ada wajah yang terdeteksi pada foto yang dipilih.');
    } catch {
      setFormMessage('Foto gagal diproses. Pilih file gambar JPG, PNG, atau WebP.');
    } finally {
      setPending(false);
      event.target.value = '';
    }
  };

  const saveUser = (event) => {
    event.preventDefault();
    if (!form.name.trim() || !form.code.trim() || !form.role.trim()) {
      setFormMessage('Lengkapi nama, ID, dan peran / kelas.');
      return;
    }
    if (!samples.length) {
      setFormMessage('Tambahkan setidaknya satu sampel wajah sebelum menyimpan.');
      return;
    }
    const record = {
      id: editingId ?? crypto.randomUUID(),
      name: form.name.trim(),
      code: form.code.trim(),
      role: form.role.trim(),
      samples: samples.map((sample) => sample.descriptor),
      photo: samples.find((sample) => sample.image)?.image ?? '',
    };
    setUsers((current) => editingId ? current.map((user) => user.id === editingId ? record : user) : [record, ...current]);
    setForm({ name: '', code: '', role: '' });
    setSamples([]);
    setEditingId(null);
    setFormMessage(editingId ? 'Data pengguna berhasil diperbarui.' : 'Pengguna berhasil didaftarkan.');
  };

  const editUser = (user) => {
    setEditingId(user.id);
    setForm({ name: user.name, code: user.code, role: user.role });
    setSamples((user.samples ?? []).map((descriptor) => ({ descriptor, image: user.photo })));
    setFormMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteUser = (user) => {
    if (!window.confirm(`Hapus data ${user.name}? Riwayat absensi tetap disimpan.`)) return;
    setUsers((current) => current.filter((item) => item.id !== user.id));
    if (editingId === user.id) {
      setEditingId(null);
      setForm({ name: '', code: '', role: '' });
      setSamples([]);
    }
  };

  const clearForm = () => {
    setEditingId(null);
    setForm({ name: '', code: '', role: '' });
    setSamples([]);
    setFormMessage('');
  };

  const signIn = async (event) => {
    event.preventDefault();
    setAuthPending(true);
    setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    if (error) setAuthError('Login gagal. Periksa email dan kata sandi admin.');
    setAuthPending(false);
  };

  const signOut = async () => {
    setCameraEnabled(false);
    setRepeatUserId(null);
    await supabase.auth.signOut();
    setAuthUser(null);
    setCloudReady(false);
    setUsers([]);
    setLogs([]);
    usersSyncRef.current.clear();
    logsSyncRef.current.clear();
  };

  if (supabaseConfigured && !authReady) {
    return <main className="auth-shell"><div className="auth-panel"><span className="brand-mark"><span /></span><h1>Memeriksa sesi</h1><LoaderCircle className="spinner" size={20} /></div></main>;
  }

  if (supabaseConfigured && !authUser) {
    return <main className="auth-shell"><form className="auth-panel" onSubmit={signIn}><span className="brand-mark"><span /></span><span className="section-kicker">RUANG HADIR · ADMIN</span><h1>Masuk ke workspace</h1><p>Data absensi tersimpan di Supabase dan aksesnya dibatasi untuk admin terdaftar.</p><label>Email<input type="email" autoComplete="username" required value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="admin@sekolah.id" /></label><label>Kata sandi<input type="password" autoComplete="current-password" required value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="Kata sandi admin" /></label>{authError && <div className="form-message">{authError}</div>}<button className="button button-dark" type="submit" disabled={authPending}>{authPending ? <LoaderCircle className="spinner" size={15} /> : <LogIn size={15} />}Masuk</button></form></main>;
  }

  if (supabaseConfigured && authUser && !cloudReady) {
    return <main className="auth-shell"><div className="auth-panel"><span className="brand-mark"><span /></span><span className="section-kicker">SINKRONISASI SUPABASE</span><h1>{cloudError ? 'Data belum dapat dibuka' : 'Memuat data cloud'}</h1><p>{cloudError || 'Mengambil data pengguna dan absensi...'}</p>{cloudError ? <button className="button button-dark" onClick={() => setCloudRetry((value) => value + 1)}>Coba lagi</button> : <LoaderCircle className="spinner" size={20} />}</div></main>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" onClick={(event) => event.preventDefault()}>
          <span className="brand-mark"><span /></span>
          <span className="brand-copy"><strong>ruang<span>hadir</span></strong><small>ABSENSI DIGITAL</small></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Navigasi utama">
          <button className={`nav-item ${activeTab === 'live' ? 'active' : ''}`} onClick={() => setActiveTab('live')}><LayoutDashboard size={18} /><span>Absensi Live</span>{activeTab === 'live' && <span className="nav-dot" />}</button>
          <button className={`nav-item ${activeTab === 'register' ? 'active' : ''}`} onClick={() => setActiveTab('register')}><UserRound size={18} /><span>Data Wajah</span>{activeTab === 'register' && <span className="nav-dot" />}</button>
          <button className={`nav-item ${activeTab === 'reports' ? 'active' : ''}`} onClick={() => setActiveTab('reports')}><FileSpreadsheet size={18} /><span>Laporan Absensi</span>{activeTab === 'reports' && <span className="nav-dot" />}</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note"><ShieldCheck size={16} /><span>Data wajah tersimpan<br />lokal di browser ini.</span></div>
          <div className="profile-row"><div className="profile-avatar">RH</div><div className="profile-meta"><strong>{authUser?.email ?? 'Administrator'}</strong><span>{supabaseConfigured ? 'Supabase cloud' : 'Workspace lokal'}</span></div><MoreHorizontal size={18} className="muted-icon" /></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{activeTab === 'live' ? 'Absensi Live' : activeTab === 'register' ? 'Data Wajah' : 'Laporan Absensi'}</strong></div>
          <div className="top-actions">
            <div className="date-chip"><Clock3 size={15} /><span>{new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)}</span></div>
            {supabaseConfigured && <><span className={`cloud-status ${cloudError ? 'error' : ''}`} title={cloudError || 'Perubahan tersimpan di Supabase'}><i />{cloudError ? 'Belum tersinkron' : 'Sinkron cloud'}</span>{cloudError && <button className="icon-button" aria-label="Coba sinkronkan lagi" title="Coba sinkronkan lagi" onClick={() => setSyncRetry((value) => value + 1)}><RotateCcw size={15} /></button>}</>}
            <button className="icon-button" aria-label="Ganti tema" title="Ganti tema" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}</button>
            <button className="icon-button notification-button" aria-label="Notifikasi"><Bell size={17} /><i /></button>
            {supabaseConfigured && <button className="icon-button" aria-label="Keluar" title="Keluar" onClick={signOut}><LogOut size={16} /></button>}
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div><div className="eyebrow">{activeTab === 'live' ? 'PANTAU KEHADIRAN' : activeTab === 'register' ? 'DIREKTORI PENGGUNA' : 'RINGKASAN DATA'}</div><h1>{activeTab === 'live' ? 'Selamat pagi.' : activeTab === 'register' ? 'Data wajah' : 'Laporan absensi'}</h1><p>{activeTab === 'live' ? 'Pantau kehadiran secara langsung dan otomatis.' : activeTab === 'register' ? 'Kelola identitas dan sampel wajah terdaftar.' : 'Telusuri dan ekspor riwayat kehadiran.'}</p></div>
            <div className="live-clock"><span className="clock-dot" />{timeLabel(now)} <span className="clock-zone">WIB</span></div>
          </div>

          {activeTab === 'live' && (
            <>
              <div className="stats-row">
                <div className="stat-block"><div className="stat-label"><span>HADIR HARI INI</span><span className="stat-symbol green-symbol"><Check size={15} /></span></div><div className="stat-value">{String(presentCount).padStart(2, '0')}<small> orang</small></div><div className="stat-foot">Dari {users.length} pengguna terdaftar</div></div>
                <div className="stat-block"><div className="stat-label"><span>BELUM ABSEN</span><span className="stat-symbol coral-symbol"><UsersRound size={15} /></span></div><div className="stat-value">{String(absentCount).padStart(2, '0')}<small> orang</small></div><div className="stat-foot">Menunggu identifikasi wajah</div></div>
                <div className="stat-block status-stat"><div className="stat-label"><span>STATUS SISTEM</span><span className={`status-pill ${modelState === 'ready' ? 'ready' : modelState === 'error' ? 'error' : ''}`}><span />{modelState === 'ready' ? 'Sistem siap' : modelState === 'error' ? 'Model gagal' : 'Memuat model'}</span></div><div className="system-main">{modelState === 'ready' ? 'Pengenalan wajah aktif' : modelState === 'error' ? 'Periksa koneksi internet' : 'Menyiapkan pengenalan'}</div><div className="stat-foot">Pemrosesan dilakukan di browser</div></div>
              </div>
              <div className="live-grid">
                <section className="surface camera-panel">
                  <div className="surface-heading"><div><span className="section-kicker">KAMERA UTAMA</span><h2>Live recognition</h2></div><span className={`camera-status ${cameraReady ? 'online' : ''}`}><i />{cameraReady ? 'KAMERA AKTIF' : 'KAMERA NONAKTIF'}</span></div>
                  <div className={`camera-stage ${cameraReady ? 'has-feed' : ''}`}>
                    <video ref={videoRef} autoPlay muted playsInline className="camera-video" />
                    <canvas ref={overlayRef} className="face-overlay" />
                    {!cameraReady && <div className="camera-placeholder"><div className="camera-placeholder-icon"><Camera size={26} /></div><strong>{cameraError ? 'Kamera belum tersedia' : 'Feed kamera belum dimulai'}</strong><span>{cameraError || 'Aktifkan kamera untuk mulai memindai wajah.'}</span>{!cameraError && <button className="button button-dark" onClick={enableCamera}><Video size={16} />Aktifkan kamera</button>}{cameraError && <button className="button button-dark" onClick={enableCamera}><Camera size={16} />Coba lagi</button>}</div>}
                    <div className="camera-overlay-top"><span className="scan-live"><i /> LIVE</span><span className="resolution-tag">HD · 30 FPS</span></div>
                    {repeatUser && <div className="repeat-banner"><RotateCcw size={15} /><span>Absen ulang <strong>{repeatUser.name}</strong>: pastikan wajahnya terlihat di kamera.</span><button onClick={cancelRepeatAttendance} aria-label="Batalkan absen ulang"><X size={14} /></button></div>}
                    {cameraReady && recognized && <div className="recognized-toast"><div className="recognized-check"><Check size={18} /></div><div><strong>{recognized.alreadyPresent ? 'Sudah tercatat hari ini' : 'Hadir'}</strong><span>{recognized.user.name} · {recognized.user.role}</span></div><small>{recognized.time}</small><button aria-label="Tutup notifikasi" onClick={() => setRecognized(null)}><X size={15} /></button></div>}
                  </div>
                  <div className="camera-controls"><label className="select-wrap"><Camera size={15} /><select value={cameraId} onChange={(event) => setCameraId(event.target.value)} aria-label="Pilih kamera"><option value="">Kamera default</option>{devices.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `Kamera ${index + 1}`}</option>)}</select><ChevronDown size={14} /></label><button className={`scan-toggle ${scanning ? 'is-on' : ''}`} onClick={() => setScanning((value) => !value)} disabled={!cameraReady || !modelsReady}><span className="toggle-track"><i /></span>{scanning ? 'Pemindaian aktif' : 'Pemindaian jeda'}</button><button className="icon-button" aria-label={cameraReady ? 'Matikan kamera' : 'Aktifkan kamera'} title={cameraReady ? 'Matikan kamera' : 'Aktifkan kamera'} onClick={() => cameraReady ? setCameraEnabled(false) : enableCamera()}>{cameraReady ? <VideoOff size={15} /> : <Video size={15} />}</button><span className="cooldown-label"><Volume2 size={14} />Cooldown 8 detik</span></div>
                </section>
                <section className="surface activity-panel">
                  <div className="surface-heading"><div><span className="section-kicker">HARI INI · {formatDate(todayKey())}</span><h2>Aktivitas terbaru</h2></div><button className="text-button" onClick={() => setActiveTab('reports')}>Lihat semua <span>↗</span></button></div>
                  <div className="activity-summary"><div><strong>{String(todayLogs.length).padStart(2, '0')}</strong><span>tercatat hari ini</span></div><div className="summary-line"><i style={{ width: `${users.length ? Math.min((presentCount / users.length) * 100, 100) : 0}%` }} /></div><span className="summary-percent">{users.length ? Math.round((presentCount / users.length) * 100) : 0}%</span></div>
                  <div className="activity-list">
                    {todayLogs.slice(0, 5).map((log) => <div className="activity-item" key={log.id}><div className="activity-avatar">{log.image ? <img src={log.image} alt="" /> : log.name.slice(0, 1)}</div><div className="activity-person"><strong>{log.name}</strong><span>{log.role} · {log.code}</span></div><div className="activity-time"><b>{log.time}</b><span><i />Hadir</span></div></div>)}
                    {!todayLogs.length && <div className="empty-activity"><div className="empty-icon"><UsersRound size={20} /></div><strong>Belum ada kehadiran</strong><span>Catatan akan muncul di sini setelah wajah dikenali.</span></div>}
                  </div>
                  <div className="activity-footer"><span><span className="footer-dot" />{supabaseConfigured ? 'Sinkronisasi Supabase aktif' : 'Penyimpanan lokal aktif'}</span><button className="icon-text-button" onClick={() => setActiveTab('register')}><Plus size={15} />Daftarkan wajah</button></div>
                </section>
              </div>
              <div className="privacy-strip"><ShieldCheck size={16} /><span><strong>Privasi terjaga.</strong> Pengenalan wajah diproses di browser; {supabaseConfigured ? 'data disimpan di Supabase dan hanya dapat diakses admin.' : 'data tersimpan lokal di browser ini.'}</span><button aria-label="Informasi privasi" title={supabaseConfigured ? 'Pengenalan wajah berjalan lokal; catatan disinkronkan ke Supabase.' : 'Data tidak dikirim ke server.'}><CircleHelp size={16} /></button></div>
            </>
          )}

          {activeTab === 'register' && (
            <>
              <div className="register-layout">
                <section className="surface registration-panel">
                  <div className="surface-heading"><div><span className="section-kicker">PROFIL BARU</span><h2>{editingId ? 'Edit pengguna' : 'Registrasi wajah'}</h2></div>{editingId && <button className="icon-button small" aria-label="Batal edit" onClick={clearForm}><X size={16} /></button>}</div>
                  <form className="registration-form" onSubmit={saveUser}>
                    <div className="field-row"><label>Nama lengkap<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Contoh: Aditya Pratama" /></label><label>NIS / NIP / ID<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="Contoh: 240103" /></label></div>
                    <label>Peran / kelas<input value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} placeholder="Contoh: Siswa · XI RPL 1" /></label>
                    <div className="capture-heading"><div><strong>Sampel wajah</strong><span>Ambil 3–5 foto dengan sudut sedikit berbeda.</span></div><span className="sample-count">{samples.length}<small> / 5</small></span></div>
                    <div className="capture-box"><div className="capture-thumbnails">{samples.map((sample, index) => <div className="sample-thumb" key={`${index}-${sample.descriptor.length}`}><img src={sample.image || users.find((user) => user.id === editingId)?.photo} alt={`Sampel ${index + 1}`} /><span>{String(index + 1).padStart(2, '0')}</span><button type="button" aria-label={`Hapus sampel ${index + 1}`} onClick={() => setSamples((current) => current.filter((_, sampleIndex) => sampleIndex !== index))}><X size={12} /></button></div>)}{samples.length < 5 && <button type="button" className="add-sample" onClick={captureSample} disabled={pending || !cameraReady || !modelsReady}><Plus size={18} /><span>Ambil foto</span></button>}</div><div className="capture-actions"><button type="button" className="button button-outline" onClick={captureSample} disabled={pending || !cameraReady || !modelsReady}><Camera size={15} />{pending ? 'Memproses...' : 'Tangkap dari kamera'}</button><label className="button button-quiet upload-button"><ImagePlus size={15} />Upload foto<input type="file" accept="image/*" multiple onChange={uploadSamples} disabled={pending || !modelsReady} /></label></div><div className="capture-hint"><span className={`model-indicator ${modelsReady ? 'ready' : ''}`} />{modelsReady ? cameraReady ? 'Kamera siap mengambil sampel.' : 'Aktifkan kamera di tab Absensi Live untuk menangkap foto.' : modelState === 'error' ? 'Model gagal dimuat; periksa koneksi internet.' : 'Memuat model pengenalan wajah...'}</div></div>
                    {formMessage && <div className={`form-message ${formMessage.includes('berhasil') ? 'success' : ''}`}>{formMessage}</div>}
                    <div className="form-actions"><button type="submit" className="button button-dark" disabled={pending}><CheckCircle2 size={16} />{editingId ? 'Simpan perubahan' : 'Simpan pengguna'}</button><button type="button" className="button button-quiet" onClick={clearForm}>Reset</button></div>
                  </form>
                </section>
                <section className="surface capture-preview"><div className="surface-heading"><div><span className="section-kicker">PRATINJAU KAMERA</span><h2>Posisikan wajah</h2></div><span className={`camera-status ${cameraReady ? 'online' : ''}`}><i />{cameraReady ? 'AKTIF' : 'NONAKTIF'}</span></div><div className={`mini-camera-stage ${cameraReady ? 'has-feed' : ''}`}><video ref={videoRef} autoPlay muted playsInline className="camera-video" />{!cameraReady && <div className="mini-camera-empty"><Camera size={22} /><span>Feed kamera belum dimulai</span><button className="text-button" onClick={enableCamera}>Aktifkan kamera <span>↗</span></button></div>}<div className="face-guide" /></div><div className="capture-instructions"><div><span>01</span><p>Pastikan wajah terlihat jelas dan pencahayaan cukup.</p></div><div><span>02</span><p>Ambil sampel dari depan, lalu ubah sedikit sudut wajah.</p></div><div><span>03</span><p>Foto tidak dikirim ke server, tersimpan lokal di browser.</p></div></div></section>
              </div>
              <section className="surface users-section"><div className="surface-heading"><div><span className="section-kicker">DIREKTORI</span><h2>Pengguna terdaftar <span className="count-badge">{users.length}</span></h2></div><label className="table-search"><Search size={15} /><input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Cari nama atau ID" /></label></div><div className="table-scroll"><table><thead><tr><th>PENGGUNA</th><th>ID</th><th>PERAN / KELAS</th><th>SAMPEL</th><th></th></tr></thead><tbody>{visibleUsers.map((user) => <tr key={user.id}><td><div className="table-person"><div className="table-avatar">{user.photo ? <img src={user.photo} alt="" /> : user.name.slice(0, 1)}</div><strong>{user.name}</strong></div></td><td className="mono-cell">{user.code}</td><td>{user.role}</td><td><span className="sample-badge">{user.samples?.length ?? 0} foto</span></td><td><div className="row-actions"><button title="Edit pengguna" aria-label={`Edit ${user.name}`} onClick={() => editUser(user)}><Edit3 size={15} /></button><button title="Hapus pengguna" aria-label={`Hapus ${user.name}`} onClick={() => deleteUser(user)}><Trash2 size={15} /></button></div></td></tr>)}{!visibleUsers.length && <tr><td colSpan="5"><div className="table-empty"><UserRound size={18} /><span>{users.length ? 'Tidak ada pengguna yang cocok.' : 'Belum ada data pengguna. Daftarkan wajah pertama untuk memulai.'}</span></div></td></tr>}</tbody></table></div></section>
            </>
          )}

          {activeTab === 'reports' && (
            <>
              <div className="report-summary"><div><span className="section-kicker">TOTAL CATATAN</span><strong>{filteredLogs.length}<small> absensi</small></strong><span className="stat-foot">Berdasarkan filter yang dipilih</span></div><div className="report-summary-icon"><FileSpreadsheet size={20} /></div><button className="button button-dark export-button" onClick={() => downloadCsv(filteredLogs)} disabled={!filteredLogs.length}><Download size={16} />Ekspor CSV</button></div>
              <div className="attendance-actions"><label className="attendance-target"><span>Pilih catatan</span><select value={selectedAttendance?.id ?? ''} onChange={(event) => setSelectedAttendanceId(event.target.value)} disabled={!filteredLogs.length}>{filteredLogs.map((log) => <option key={log.id} value={log.id}>{log.name} · {log.time} · {formatDate(log.date)}</option>)}</select></label><button className="button button-outline" onClick={() => repeatAttendance(selectedAttendance)} disabled={!selectedAttendance || selectedAttendance.date !== todayKey()} title={selectedAttendance?.date === todayKey() ? 'Perbarui catatan setelah wajah dikenali kembali' : 'Absen ulang hanya tersedia untuk hari ini'}><RotateCcw size={15} />Absen ulang</button><button className="button button-outline danger-button" onClick={() => deleteAttendance(selectedAttendance)} disabled={!selectedAttendance}><Trash2 size={15} />Hapus catatan</button><button className="button button-outline danger-button" onClick={deleteAttendanceDay} disabled={!filterDate || !logs.some((log) => log.date === filterDate)}><Trash2 size={15} />Hapus hari terpilih</button></div>
              <section className="surface report-panel"><div className="surface-heading report-heading"><div><span className="section-kicker">RIWAYAT KEHADIRAN</span><h2>Log absensi</h2></div><button className="button button-outline export-secondary" onClick={() => downloadCsv(filteredLogs)} disabled={!filteredLogs.length}><ArrowDownToLine size={15} />Unduh CSV</button></div><div className="filter-bar"><label className="date-filter"><Clock3 size={15} /><input type="date" value={filterDate} onChange={(event) => setFilterDate(event.target.value)} /></label><label className="table-search report-search"><Search size={15} /><input value={filterName} onChange={(event) => setFilterName(event.target.value)} placeholder="Cari nama..." /></label><button className="filter-reset" onClick={() => { setFilterDate(''); setFilterName(''); }}><ListFilter size={15} />Reset filter</button><span className="results-count">{filteredLogs.length} hasil</span></div><div className="table-scroll report-table-wrap"><table><thead><tr><th>WAKTU</th><th>PENGGUNA</th><th>ID</th><th>PERAN / KELAS</th><th>STATUS</th><th>FOTO</th></tr></thead><tbody>{filteredLogs.map((log) => <tr key={log.id}><td><span className="time-cell">{log.time}</span><small className="date-cell">{formatDate(log.date)}</small></td><td><div className="table-person"><div className="table-avatar">{log.image ? <img src={log.image} alt="" /> : log.name.slice(0, 1)}</div><strong>{log.name}</strong></div></td><td className="mono-cell">{log.code}</td><td>{log.role}</td><td><span className="attendance-status"><i />{log.status}</span></td><td>{log.image ? <button className="snapshot-button" title="Buka foto tangkapan" onClick={() => window.open(log.image, '_blank', 'noopener,noreferrer')}><img src={log.image} alt={`Foto ${log.name}`} /></button> : <span className="no-snapshot">—</span>}</td></tr>)}{!filteredLogs.length && <tr><td colSpan="6"><div className="table-empty"><Search size={18} /><span>Tidak ada catatan absensi untuk filter ini.</span></div></td></tr>}</tbody></table></div><div className="report-footer"><span>Data tersimpan di browser ini</span><span>Format ekspor: CSV (kompatibel Excel)</span></div></section>
            </>
          )}
          <footer className="page-footer"><span>RUANG HADIR <i>·</i> SISTEM ABSENSI DIGITAL</span><span>{supabaseConfigured ? 'Data cloud tersinkron' : 'Data tersimpan lokal'} <span className="footer-dot" /></span></footer>
        </div>
      </main>
    </div>
  );
}

export default App;
