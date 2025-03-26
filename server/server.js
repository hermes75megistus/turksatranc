const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const { setupSocketIO } = require('./socket-handler');

// Load environment variables
dotenv.config();

// Define default environment variables if not set
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/turksatranc';
const SESSION_SECRET = process.env.SESSION_SECRET || 'turksatranc-secure-session-key';
const PORT = process.env.PORT || 5000;

// Uygulama başlatma
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Mongoose Yapılandırması
mongoose.set('strictQuery', false); // Deprecation uyarısını önlemek için
mongoose.set('debug', process.env.NODE_ENV !== 'production'); // Debug modunu sadece production olmayan ortamlarda aktifleştir

// MongoDB bağlantısı (geliştirilmiş hata işleme)
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('MongoDB bağlantısı başarılı: ' + mongoose.connection.readyState);
  // Veritabanı bağlantı kontrolü
  return mongoose.connection.db.admin().ping();
})
.then(() => console.log('MongoDB veritabanı yanıt veriyor'))
.catch(err => {
  console.error('MongoDB bağlantı hatası:', err);
  console.error('MongoDB bağlantı hatası detayları:', err);
});

// User model
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  registeredAt: { type: Date, default: Date.now },
  elo: { type: Number, default: 1200 },
  gamesPlayed: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  draws: { type: Number, default: 0 },
  isGuest: { type: Boolean, default: false } // Misafir kullanıcı olup olmadığı
});

const User = mongoose.model('User', UserSchema);

// Game model
const GameSchema = new mongoose.Schema({
  whitePlayer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  blackPlayer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  result: { type: String, enum: ['white', 'black', 'draw', 'ongoing'], default: 'ongoing' },
  pgn: { type: String, default: '' },
  fen: { type: String, default: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
  timeControl: { type: Number, default: 10 }, // dakika cinsinden
  startTime: { type: Date, default: Date.now },
  endTime: { type: Date },
  moves: [{ 
    from: String, 
    to: String, 
    timestamp: { type: Date, default: Date.now } 
  }]
});

const Game = mongoose.model('Game', GameSchema);

// Model'leri dışa aktar ki socket-handler.js'de kullanabilelim
module.exports.User = User;
module.exports.Game = Game;

// Middleware ayarları
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

// Rate limiting için middleware
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 dakika
const RATE_LIMIT_MAX = 5; // maksimum deneme sayısı

const rateLimiter = (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  
  // Geçerli penceredeki giriş denemelerini temizle
  if (loginAttempts.has(ip)) {
    const attempts = loginAttempts.get(ip).filter(time => now - time < RATE_LIMIT_WINDOW);
    loginAttempts.set(ip, attempts);
    
    if (attempts.length >= RATE_LIMIT_MAX) {
      return res.status(429).json({ 
        error: 'Çok fazla giriş denemesi yaptınız. Lütfen 15 dakika sonra tekrar deneyin.'
      });
    }
  }
  
  next();
};

// Session yönetimi
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true, // Misafir kullanıcılar için true olmalı
  store: MongoStore.create({ 
    mongoUrl: MONGODB_URI,
    ttl: 60 * 60 * 24 // 1 gün
  }),
  cookie: { 
    maxAge: 1000 * 60 * 60 * 24, // 1 gün
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' // Production'da HTTPS kullan
  }
}));

// Auth middleware - Giriş yapılmamışsa misafir kullanıcı oluştur
const isAuthenticated = async (req, res, next) => {
  // Eğer oturum zaten varsa devam et
  if (req.session.userId) {
    return next();
  }
  
  // API istekleri için 401 hatası döndür
  if (req.path.startsWith('/api/') && req.path !== '/api/misafir-giris') {
    if (req.xhr || req.headers.accept && req.headers.accept.indexOf('json') > -1) {
      return res.status(401).json({ error: 'Giriş yapmanız gerekiyor', redirect: '/giris' });
    }
  }
  
  // HTML sayfası istekleri için giriş sayfasına yönlendir
  if (!req.path.startsWith('/api/') && req.path !== '/giris' && req.path !== '/kayit' && req.path !== '/') {
    return res.redirect('/giris');
  }
  
  // Ana sayfa veya API dışındaki istekler için devam et
  next();
};

// Misafir kullanıcı oluşturma fonksiyonu
const createGuestUser = async () => {
  try {
    const guestUsername = `Misafir_${Math.random().toString(36).substring(2, 10)}`;
    const guestEmail = `${guestUsername}@turksatranc.com`;
    const guestPassword = Math.random().toString(36).substring(2, 15);
    
    // Parolayı hashle
    const hashedPassword = await bcrypt.hash(guestPassword, 10);
    
    // Misafir kullanıcı oluştur
    const guestUser = new User({
      username: guestUsername,
      email: guestEmail,
      password: hashedPassword,
      isGuest: true
    });
    
    await guestUser.save();
    return guestUser;
  } catch (error) {
    console.error('Misafir kullanıcı oluşturma hatası:', error);
    throw error;
  }
};

module.exports.createGuestUser = createGuestUser;

// Express error handling middleware
app.use((err, req, res, next) => {
  console.error('Express hata yakalama:', err);
  res.status(500).json({ error: 'Sunucu hatası', details: err.message });
});

// Routes - Giriş ve Kayıt İşlemleri
app.get('/giris', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/giris.html'));
});

app.get('/kayit', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/kayit.html'));
});

// Misafir giriş API'si
app.post('/api/misafir-giris', async (req, res) => {
  try {
    // Misafir kullanıcı oluştur
    const guestUser = await createGuestUser();
    
    // Oturumu başlat
    req.session.userId = guestUser._id;
    req.session.isGuest = true;
    
    res.json({ 
      success: true, 
      redirect: '/',
      user: {
        username: guestUser.username,
        elo: guestUser.elo,
        isGuest: true
      }
    });
  } catch (error) {
    console.error('Misafir giriş hatası:', error);
    res.status(500).json({ error: 'Misafir giriş işlemi başarısız oldu' });
  }
});

app.post('/api/kayit', async (req, res) => {
  try {
    console.log('Kayıt isteği alındı:', req.body);
    const { username, email, password, passwordConfirm } = req.body;
    
    // Temel doğrulama işlemleri
    if (!username || !email || !password || !passwordConfirm) {
      return res.status(400).json({ error: 'Tüm alanları doldurunuz' });
    }
    
    // Kullanıcı adı ve email formatını kontrol et
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ 
        error: 'Kullanıcı adı 3-20 karakter arasında olmalı ve sadece harf, rakam ve alt çizgi içermelidir'
      });
    }
    
    if (!/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ error: 'Geçerli bir e-posta adresi giriniz' });
    }
    
    // Parola kontrolleri
    if (password.length < 6) {
      return res.status(400).json({ error: 'Parola en az 6 karakter olmalıdır' });
    }
    
    if (password !== passwordConfirm) {
      return res.status(400).json({ error: 'Parolalar eşleşmiyor' });
    }
    
    // Kullanıcı adı veya e-posta kontrolü
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ error: 'Bu kullanıcı adı veya e-posta adresi zaten kullanılıyor' });
    }
    
    // Parola hashleme
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Yeni kullanıcı oluşturma
    const newUser = new User({
      username,
      email,
      password: hashedPassword
    });
    
    await newUser.save();
    console.log('Yeni kullanıcı kaydedildi:', username);
    
    // Oturum başlatma
    req.session.userId = newUser._id;
    req.session.isGuest = false;
    
    res.status(201).json({ success: true, redirect: '/' });
  } catch (error) {
    console.error('Kayıt hatası:', error);
    res.status(500).json({ error: 'Kayıt sırasında bir hata oluştu', details: error.message });
  }
});

app.post('/api/giris', rateLimiter, async (req, res) => {
  try {
    console.log('Giriş isteği alındı:', req.body);
    const { username, password } = req.body;
    
    // Girdi doğrulama
    if (!username || !password) {
      return res.status(400).json({ error: 'Kullanıcı adı ve parola gereklidir' });
    }
    
    // Kullanıcıyı bulma
    const user = await User.findOne({ username });
    if (!user) {
      // Rate limiter için giriş denemesini kaydet
      const ip = req.ip;
      const attempts = loginAttempts.get(ip) || [];
      attempts.push(Date.now());
      loginAttempts.set(ip, attempts);
      
      return res.status(400).json({ error: 'Geçersiz kullanıcı adı veya parola' });
    }
    
    // Parola kontrolü
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      // Rate limiter için giriş denemesini kaydet
      const ip = req.ip;
      const attempts = loginAttempts.get(ip) || [];
      attempts.push(Date.now());
      loginAttempts.set(ip, attempts);
      
      return res.status(400).json({ error: 'Geçersiz kullanıcı adı veya parola' });
    }
    
    // Oturum başlatma
    req.session.userId = user._id;
    req.session.isGuest = false;
    
    console.log('Kullanıcı girişi yapıldı:', username);
    
    res.json({ success: true, redirect: '/' });
  } catch (error) {
    console.error('Giriş hatası:', error);
    res.status(500).json({ error: 'Giriş sırasında bir hata oluştu', details: error.message });
  }
});

app.get('/api/cikis', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Çıkış hatası:', err);
      return res.status(500).json({ error: 'Çıkış yapılırken bir hata oluştu' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true, redirect: '/giris' });
  });
});

// Kullanıcı profil sayfası - Auth gerektirir
app.get('/profil', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/profil.html'));
});

app.get('/api/kullanici', async (req, res) => {
  try {
    // Kullanıcı girişi yoksa misafir kullanıcı bilgisi döndür
    if (!req.session.userId) {
      return res.json({
        username: 'Misafir',
        elo: 1200,
        isGuest: true
      });
    }
    
    console.log('Kullanıcı bilgisi isteniyor, userId:', req.session.userId);
    const user = await User.findById(req.session.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    console.log('Kullanıcı bilgisi gönderiliyor:', user.username);
    res.json(user);
  } catch (error) {
    console.error('Kullanıcı bilgisi alma hatası:', error);
    res.status(500).json({ error: 'Kullanıcı bilgisi alınırken bir hata oluştu', details: error.message });
  }
});

// Şifre değiştirme endpoint'i
app.post('/api/sifre-degistir', isAuthenticated, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    // Girdi doğrulama
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Mevcut ve yeni parola gereklidir' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Yeni parola en az 6 karakter olmalıdır' });
    }
    
    // Kullanıcıyı bul
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    
    // Mevcut parolayı kontrol et
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Mevcut parola hatalı' });
    }
    
    // Yeni parolayı hashle
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Parolayı güncelle
    await User.findByIdAndUpdate(req.session.userId, { password: hashedPassword });
    
    res.json({ success: true, message: 'Parola başarıyla değiştirildi' });
  } catch (error) {
    console.error('Parola değiştirme hatası:', error);
    res.status(500).json({ error: 'Parola değiştirilirken bir hata oluştu' });
  }
});

// Ana sayfa ve diğer sayfalar
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/siralama', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/siralama.html'));
});

app.get('/api/siralama', isAuthenticated, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const searchTerm = req.query.search || '';
    
    let query = {};
    if (searchTerm) {
      query.username = { $regex: searchTerm, $options: 'i' };
    }
    
    const totalUsers = await User.countDocuments(query);
    const totalPages = Math.ceil(totalUsers / limit);
    
    const users = await User.find(query)
      .sort({ elo: -1 })
      .skip(skip)
      .limit(limit)
      .select('username elo gamesPlayed wins losses draws');
    
    res.json({ 
      users,
      pagination: {
        totalUsers,
        totalPages,
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    console.error('Sıralama alma hatası:', error);
    res.status(500).json({ error: 'Sıralama alınırken bir hata oluştu', details: error.message });
  }
});

app.get('/gecmis-oyunlar', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/gecmis-oyunlar.html'));
});

app.get('/api/gecmis-oyunlar', isAuthenticated, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    
    const games = await Game.find({
      $or: [
        { whitePlayer: req.session.userId },
        { blackPlayer: req.session.userId }
      ],
      result: { $ne: 'ongoing' }
    })
    .sort({ endTime: -1 })
    .limit(limit)
    .populate('whitePlayer', 'username')
    .populate('blackPlayer', 'username');
    
    res.json(games);
  } catch (error) {
    console.error('Geçmiş oyunlar alma hatası:', error);
    res.status(500).json({ error: 'Geçmiş oyunlar alınırken bir hata oluştu', details: error.message });
  }
});

// Default route
app.get('*', (req, res) => {
  res.redirect('/');
});

// Socket.io bağlantısını kur
setupSocketIO(io);

// Debug bilgilerini düzenli aralıklarla logla
setInterval(() => {
  console.log("------- SUNUCU DURUMU -------");
  const stats = require('./socket-handler').getStats();
  console.log(`Aktif oyunlar: ${stats.activeGames}`);
  console.log(`Bekleyen oyuncular: ${stats.waitingPlayers}`);
  console.log(`Socket-Kullanıcı eşleşmeleri: ${stats.userSockets}`);
  console.log("-----------------------------");
}, 60000); // Her 1 dakikada bir

// Genel hata yakalama
process.on('uncaughtException', (err) => {
  console.error('Yakalanmamış İstisna:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('İşlenmeyen Reddetme:', reason);
});

// Sunucuyu başlat
server.listen(PORT, () => {
  console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
});
