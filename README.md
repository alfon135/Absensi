# Ruang Hadir

Aplikasi absensi berbasis pengenalan wajah yang berjalan di browser. Supabase wajib dikonfigurasi: admin harus login sebelum data siswa dan riwayat absensi dimuat. Tanpa konfigurasi Supabase, aplikasi menampilkan petunjuk penyiapan dan tidak membuka data lokal.

## Menjalankan

```bash
npm install
npm run dev
```

Buka URL lokal yang ditampilkan Vite. Kamera memerlukan izin browser dan berjalan pada `localhost` atau origin HTTPS. Model face-api.js dimuat dari jsDelivr saat aplikasi dibuka, sehingga koneksi internet diperlukan pada pemakaian pertama.

## Fitur

- Absensi live dengan pilihan perangkat kamera, termasuk kamera virtual yang tersedia di browser.
- Deteksi wajah dan pencocokan descriptor di browser menggunakan `@vladmandic/face-api`.
- Registrasi pengguna lewat kamera atau unggah foto, hingga lima sampel per pengguna.
- Riwayat absensi dengan waktu, foto ringkas, filter, serta ekspor CSV yang dapat dibuka di Excel.
- Absen ulang, hapus catatan, dan hapus seluruh catatan pada tanggal terpilih.
- Tema terang/gelap.

## Supabase

1. Buat project di [supabase.com](https://supabase.com/) dan simpan password database dengan aman.
2. Buka **SQL Editor**, jalankan isi `supabase/schema.sql`.
3. Di **Authentication → Users**, pengelola project membuat akun admin. Matikan public sign-ups agar akun tidak bisa didaftarkan dari aplikasi atau oleh pengunjung.
4. Salin UUID akun admin, lalu jalankan di SQL Editor:

	```sql
	insert into public.app_admins (user_id) values ('UUID-AKUN-ADMIN');
	```

5. Salin **Project URL** dan **publishable/anon key** dari Project Settings → API. Jangan pernah gunakan `service_role` key di frontend.
6. Untuk lokal, salin `.env.example` menjadi `.env.local`, lalu isi `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY`. Jalankan `npm run dev`.
7. Data lokal lama akan diimpor satu kali setelah admin login, jika tabel cloud masih kosong. Pastikan Supabase siap sebelum membuka aplikasi dengan kredensial baru.

## Deploy publik ke Vercel

1. Unggah/push folder proyek ini ke repository GitHub milikmu.
2. Masuk ke [vercel.com](https://vercel.com/), pilih **Add New → Project**, lalu import repository tersebut.
3. Tambahkan environment variables `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` pada Vercel Project Settings → Environment Variables. Gunakan nilai yang sama seperti Supabase.
4. Pilih framework **Vite**, build command `npm run build`, dan output directory `dist`, lalu deploy.
5. Vercel memberi URL `https://...vercel.app` yang dapat dibuka dari perangkat mana pun. Aplikasi tetap meminta login admin untuk melindungi data biometrik.

Setelah mengubah environment variables, lakukan redeploy. Redeploy tidak menghapus data di Supabase. Jangan commit `.env.local`, dan jangan menaruh service-role key pada Vercel frontend variables.

## Yang perlu dilakukan pemilik akun

- Membuat project Supabase dan Vercel, menyetujui persyaratan layanan, serta mengatur billing jika diperlukan.
- Membuat akun admin melalui Supabase Dashboard, memasukkan UUID-nya ke `app_admins`, mematikan public sign-ups, dan mengatur URL situs pada Supabase Authentication → URL Configuration. Tidak ada formulir pendaftaran admin di aplikasi.
- Memasukkan URL dan anon/publishable key ke environment variables secara langsung di dashboard; jangan kirim secret/password melalui chat.
- Push kode ke GitHub dan menjalankan deployment. Saya tidak dapat membuat URL publik tanpa akses login/otorisasi ke akun-akun tersebut.

## Keamanan dan biometrik

Data wajah merupakan data biometrik sensitif. Skema mengaktifkan RLS dan hanya UUID yang terdaftar di `app_admins` dapat membaca/mengubah data. Minta persetujuan pengguna, batasi akun admin, siapkan retensi/penghapusan dan backup, serta uji kebijakan sesuai aturan privasi setempat sebelum digunakan sungguhan. Pengenalan descriptor tidak menyediakan liveness detection; foto bisa dipalsukan. Data lokal lama yang masih tersimpan di browser tidak terenkripsi dan hanya berlaku pada browser/perangkat itu.
