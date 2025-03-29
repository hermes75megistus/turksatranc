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
const { v4: uuidv4 } = require('uuid');

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
.catch(err => {
  console.error('MongoDB bağlantı hatası:', err);
  console.error('MongoDB bağlantı hatası detayları:', err);
  // Veritabanı bağlantısı olmadan uygulama çalışamaz, bu yüzden sonlandır
  process.exit(1);
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
  friendInvites: [{ 
    inviteId: String,
    createdAt: { type: Date, default: Date.now },
    timeControl: Number,
    expires: Date
  }]
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
  }],
  inviteId: { type: String, default: null }, // Arkadaş davet ID'si
  isFriendGame: { type: Boolean, default: false }, // Arkadaş oyunu mu?
  tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', default: null } // Turnuva ID'si
});

const Game = mongoose.model('Game', GameSchema);

// Turnuva modeli
const TournamentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date },
  status: { 
    type: String, 
    enum: ['created', 'registration', 'inProgress', 'completed', 'cancelled'], 
    default: 'created' 
  },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  maxParticipants: { type: Number, default: 16 },
  rounds: { type: Number, default: 4 },
  timeControl: { type: Number, default: 15 }, // dakika cinsinden
  games: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Game' }],
  standings: [{
    playerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    points: { type: Number, default: 0 },
    gamesPlayed: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 }
  }],
  createdAt: { type: Date, default: Date.now }
});

const Tournament = mongoose.model('Tournament', TournamentSchema);

// Arkadaş daveti oluşturma fonksiyonu
const createFriendInvite = async (userId, timeControl) => {
  try {
    const inviteId = uuidv4(); // Benzersiz davet ID'si
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 saat geçerli
    
    // Kullanıcıya davet ekle
    await User.findByIdAndUpdate(userId, {
      $push: {
        friendInvites: {
          inviteId: inviteId,
          timeControl: timeControl,
          expires: expiresAt
        }
      }
    });
    
    return inviteId;
  } catch (error) {
    console.error('Arkadaş daveti oluşturma hatası:', error);
    throw error;
  }
};

// Modülleri dışa aktar
const gameModule = {
  User,
  Game,
  Tournament,
  createFriendInvite
};

// Socket handler'ı yükle
const { setupSocketIO } = require('./socket-handler')(gameModule);

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

// Fix for authentication issues in server.js
// Add this code to the server.js file, replacing the existing session middleware configuration

// Session configuration with improved settings for reliability
const sessionStore = MongoStore.create({ 
  mongoUrl: MONGODB_URI,
  ttl: 60 * 60 * 24, // 1 day
  autoRemove: 'native',
  touchAfter: 3600, // update session only once per hour if no changes
  crypto: {
    secret: SESSION_SECRET // encrypt session data
  }
});

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false, 
  store: sessionStore,
  cookie: { 
    maxAge: 1000 * 60 * 60 * 24, // 1 day
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', // Use HTTPS in production
    path: '/'
  },
  name: 'turksatranc.sid' // Custom session name
});

app.use(sessionMiddleware);

// Improve CORS handling
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Debug middleware to log session issues
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Session debug - Path: ${req.path}, Session ID: ${req.session.id || 'none'}, User ID: ${req.session.userId || 'none'}`);
  }
  next();
});

// Replace the existing isAuthenticated middleware with this improved version
const isAuthenticated = async (req, res, next) => {
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return next();
  }
  
  // Skip authentication for static files and login/register routes
  if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg)$/) ||
      req.path === '/giris' || 
      req.path === '/kayit' ||
      req.path === '/api/giris' || 
      req.path === '/api/kayit') {
    return next();
  }

  // Check if user is authenticated
  if (req.session && req.session.userId) {
    try {
      // Verify user exists
      const user = await User.findById(req.session.userId);
      if (user) {
        // Store user info for later use
        req.user = user;
        return next();
      }
      
      // User not found, clear session
      req.session.destroy();
    } catch (err) {
      console.error("User verification error:", err);
    }
  }
  
  // API requests should return JSON error
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ 
      error: 'Authentication required',
      redirect: '/giris'
    });
  }
  
  // For normal page requests, redirect to login
  if (!req.path.startsWith('/') || req.path !== '/') {
    return res.redirect('/giris');
  }
  
  // Allow access to homepage
  next();
};

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

// Düzeltilmiş kayıt API endpoint'i
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
    
    // Önceki oturumu temizle ve yeni oturum başlat
    req.session.regenerate(function(err) {
      if (err) {
        console.error('Oturum yenileme hatası:', err);
        return res.status(500).json({ error: 'Kayıt sırasında bir hata oluştu' });
      }

      // Yeni oturum başlat
      req.session.userId = newUser._id;
      req.session.username = newUser.username;
      
      // Oturumu kaydet
      req.session.save(function(err) {
        if (err) {
          console.error('Oturum kaydetme hatası:', err);
          return res.status(500).json({ error: 'Kayıt sırasında bir hata oluştu' });
        }
        
        res.status(201).json({ success: true, redirect: '/' });
      });
    });
  } catch (error) {
    console.error('Kayıt hatası:', error);
    res.status(500).json({ error: 'Kayıt sırasında bir hata oluştu', details: error.message });
  }
});

// Düzeltilmiş giriş API endpoint'i
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
    
    // Önceki oturumu temizle
    req.session.regenerate(function(err) {
      if (err) {
        console.error('Oturum yenileme hatası:', err);
        return res.status(500).json({ error: 'Giriş sırasında bir hata oluştu' });
      }

      // Yeni oturum başlat
      req.session.userId = user._id;
      req.session.username = user.username;
      
      // Oturumu kaydet
      req.session.save(function(err) {
        if (err) {
          console.error('Oturum kaydetme hatası:', err);
          return res.status(500).json({ error: 'Giriş sırasında bir hata oluştu' });
        }
        
        console.log('Kullanıcı girişi yapıldı:', username, 'Session ID:', req.session.id);
        
        res.json({ 
          success: true, 
          redirect: '/',
          user: {
            _id: user._id,
            username: user.username,
            elo: user.elo
          }
        });
      });
    });
  } catch (error) {
    console.error('Giriş hatası:', error);
    res.status(500).json({ error: 'Giriş sırasında bir hata oluştu' });
  }
});

app.get('/api/cikis', (req, res) => {
  console.log("Çıkış isteği, session:", req.session.userId ? "Var" : "Yok");
  
  if (!req.session.userId) {
    return res.json({ success: true, redirect: '/giris' });
  }
  
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

// Düzeltilmiş kullanıcı bilgisi API endpoint'i
app.get('/api/kullanici', async (req, res) => {
  try {
    // Session'da userId yoksa giriş sayfasına yönlendir
    if (!req.session.userId) {
      console.log("Kullanıcı bilgisi isteği: Oturum yok, hata dönülüyor");
      return res.status(401).json({ 
        error: 'Lütfen giriş yapın', 
        redirect: '/giris'
      });
    }
    
    console.log(`Kullanıcı bilgisi isteniyor, userId: ${req.session.userId}`);
    const user = await User.findById(req.session.userId).select('-password');
    
    if (!user) {
      console.log("Kullanıcı bulunamadı, hata dönülüyor");
      // Session'da userId var ama kullanıcı bulunamıyorsa session'ı temizle
      req.session.destroy();
      return res.status(401).json({
        error: 'Kullanıcı bulunamadı',
        redirect: '/giris'
      });
    }
    
    console.log(`Kullanıcı bilgisi gönderiliyor: ${user.username}`);
    res.json(user);
  } catch (error) {
    console.error('Kullanıcı bilgisi alma hatası:', error);
    res.status(500).json({ error: 'Kullanıcı bilgisi alınırken bir hata oluştu' });
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

// ======== ARKADAŞ DAVETİ ROTALARI ========

// Arkadaş daveti oluştur
app.post('/api/arkadasdaveti/olustur', isAuthenticated, async (req, res) => {
  try {
    const { timeControl } = req.body;
    
    // Geçerli bir süre kontrolü
    const validTimeControl = parseInt(timeControl) || 15;
    
    // Davet oluştur
    const inviteId = await createFriendInvite(req.session.userId, validTimeControl);
    
    // Davet URL'sini oluştur
    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    const inviteUrl = `${baseUrl}/davet/${inviteId}`;
    
    res.json({ 
      success: true, 
      inviteId: inviteId,
      inviteUrl: inviteUrl 
    });
    
  } catch (error) {
    console.error('Arkadaş daveti oluşturma hatası:', error);
    res.status(500).json({ error: 'Arkadaş daveti oluşturulurken bir hata oluştu' });
  }
});

// Arkadaş davetini doğrula ve kabul et
app.get('/api/arkadasdaveti/:inviteId', isAuthenticated, async (req, res) => {
  try {
    const { inviteId } = req.params;
    
    if (!inviteId) {
      return res.status(400).json({ error: 'Geçersiz davet ID' });
    }
    
    // Daveti bulma
    const user = await User.findOne({
      'friendInvites.inviteId': inviteId,
      'friendInvites.expires': { $gte: new Date() } // Süresi dolmamış davetler
    });
    
    if (!user) {
      return res.status(404).json({ error: 'Davet bulunamadı veya süresi dolmuş' });
    }
    
    // İlgili daveti al
    const invite = user.friendInvites.find(inv => inv.inviteId === inviteId);
    
    res.json({
      success: true,
      invite: {
        id: inviteId,
        createdBy: user.username,
        creatorId: user._id,
        timeControl: invite.timeControl,
        expires: invite.expires
      }
    });
    
  } catch (error) {
    console.error('Arkadaş daveti doğrulama hatası:', error);
    res.status(500).json({ error: 'Arkadaş daveti doğrulanırken bir hata oluştu' });
  }
});

// Davet sayfasını göster
app.get('/davet/:inviteId', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/davet.html'));
});

// ======== TURNUVA ROTALARI ========

// Turnuva sayfası
app.get('/turnuvalar', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/turnuvalar.html'));
});

app.get('/turnuva/:id', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/turnuva-detay.html'));
});

// Tüm turnuvaları getir
app.get('/api/turnuvalar', isAuthenticated, async (req, res) => {
  try {
    const status = req.query.status || 'all';
    let filter = {};
    
    if (status !== 'all') {
      filter.status = status;
    }
    
    const tournaments = await Tournament.find(filter)
      .sort({ startTime: -1 })
      .populate('creator', 'username')
      .lean(); // Performans için lean() kullan
      
    res.json(tournaments);
  } catch (error) {
    console.error('Turnuva listesi alma hatası:', error);
    res.status(500).json({ error: 'Turnuvalar alınırken bir hata oluştu' });
  }
});

// Yeni turnuva oluştur
app.post('/api/turnuvalar', isAuthenticated, async (req, res) => {
  try {
    const { name, description, startTime, maxParticipants, rounds, timeControl } = req.body;
    
    // Doğrulama
    if (!name || !startTime) {
      return res.status(400).json({ error: 'Turnuva adı ve başlangıç zamanı gereklidir' });
    }
    
    // Tarih doğrulaması
    const tournamentStartTime = new Date(startTime);
    if (isNaN(tournamentStartTime.getTime()) || tournamentStartTime < new Date()) {
      return res.status(400).json({ error: 'Geçerli bir gelecek tarih belirtmelisiniz' });
    }
    
    // Yeni turnuva oluştur
    const newTournament = new Tournament({
      name,
      description,
      creator: req.session.userId,
      startTime: tournamentStartTime,
      status: 'registration', // Kayıt açık
      maxParticipants: maxParticipants || 16,
      rounds: rounds || 4,
      timeControl: timeControl || 15,
      // Oluşturan kullanıcıyı otomatik ekle
      participants: [req.session.userId],
      standings: [{
        playerId: req.session.userId,
        points: 0,
        gamesPlayed: 0
      }]
    });
    
    await newTournament.save();
    
    res.status(201).json({ 
      success: true, 
      tournament: newTournament,
      message: 'Turnuva başarıyla oluşturuldu'
    });
    
  } catch (error) {
    console.error('Turnuva oluşturma hatası:', error);
    res.status(500).json({ error: 'Turnuva oluşturulurken bir hata oluştu' });
  }
});

// Turnuva detayı
app.get('/api/turnuvalar/:id', isAuthenticated, async (req, res) => {
  try {
    const tournamentId = req.params.id;
    
    const tournament = await Tournament.findById(tournamentId)
      .populate('creator', 'username')
      .populate('participants', 'username elo')
      .populate({
        path: 'games',
        populate: [
          { path: 'whitePlayer', select: 'username' },
          { path: 'blackPlayer', select: 'username' }
        ]
      });
      
    if (!tournament) {
      return res.status(404).json({ error: 'Turnuva bulunamadı' });
    }
    
    res.json(tournament);
  } catch (error) {
    console.error('Turnuva detayı alma hatası:', error);
    res.status(500).json({ error: 'Turnuva detayı alınırken bir hata oluştu' });
  }
});

// Turnuvaya katıl
app.post('/api/turnuvalar/:id/katil', isAuthenticated, async (req, res) => {
 try {
   const tournamentId = req.params.id;
   
   const tournament = await Tournament.findById(tournamentId);
   if (!tournament) {
     return res.status(404).json({ error: 'Turnuva bulunamadı' });
   }
   
   // Turnuva durumunu kontrol et
   if (tournament.status !== 'registration') {
     return res.status(400).json({ error: 'Bu turnuvaya artık kayıt yapılamaz' });
   }
   
   // Katılımcı sayısını kontrol et
   if (tournament.participants.length >= tournament.maxParticipants) {
     return res.status(400).json({ error: 'Turnuva kapasitesi dolu' });
   }
   
   // Zaten kayıtlı mı kontrol et
   if (tournament.participants.some(p => p.toString() === req.session.userId.toString())) {
     return res.status(400).json({ error: 'Bu turnuvaya zaten kayıtlısınız' });
   }
   
   // Turnuvaya katıl
   await Tournament.findByIdAndUpdate(tournamentId, {
     $push: { 
       participants: req.session.userId,
       standings: {
         playerId: req.session.userId,
         points: 0,
         gamesPlayed: 0
       }
     }
   });
   
   res.json({ 
     success: true, 
     message: 'Turnuvaya başarıyla katıldınız'
   });
   
 } catch (error) {
   console.error('Turnuvaya katılma hatası:', error);
   res.status(500).json({ error: 'Turnuvaya katılırken bir hata oluştu' });
 }
});

// Turnuvadan ayrıl
app.post('/api/turnuvalar/:id/ayril', isAuthenticated, async (req, res) => {
 try {
   const tournamentId = req.params.id;
   
   const tournament = await Tournament.findById(tournamentId);
   if (!tournament) {
     return res.status(404).json({ error: 'Turnuva bulunamadı' });
   }
   
   // Turnuva durumunu kontrol et
   if (tournament.status !== 'registration') {
     return res.status(400).json({ error: 'Turnuva başladıktan sonra ayrılamazsınız' });
   }
   
   // Turnuvadan ayrıl
   await Tournament.findByIdAndUpdate(tournamentId, {
     $pull: { 
       participants: req.session.userId,
       standings: { playerId: req.session.userId }
     }
   });
   
   res.json({ 
     success: true, 
     message: 'Turnuvadan başarıyla ayrıldınız'
   });
   
 } catch (error) {
   console.error('Turnuvadan ayrılma hatası:', error);
   res.status(500).json({ error: 'Turnuvadan ayrılırken bir hata oluştu' });
 }
});

// Turnuvayı başlat (sadece turnuva oluşturanı)
app.post('/api/turnuvalar/:id/baslat', isAuthenticated, async (req, res) => {
 try {
   const tournamentId = req.params.id;
   
   const tournament = await Tournament.findById(tournamentId);
   if (!tournament) {
     return res.status(404).json({ error: 'Turnuva bulunamadı' });
   }
   
   // Yetkiyi kontrol et
   if (tournament.creator.toString() !== req.session.userId.toString()) {
     return res.status(403).json({ error: 'Bu işlemi yapmaya yetkiniz yok' });
   }
   
   // Turnuva durumunu kontrol et
   if (tournament.status !== 'registration') {
     return res.status(400).json({ error: 'Bu turnuva zaten başlatılmış veya tamamlanmış' });
   }
   
   // Katılımcı sayısını kontrol et (en az 4 oyuncu)
   if (tournament.participants.length < 4) {
     return res.status(400).json({ error: 'Turnuva başlatmak için en az 4 katılımcı gerekiyor' });
   }
   
   // Eşleşmeleri oluştur
   const matches = await createTournamentMatches(tournament);
   
   // Turnuvayı başlat
   await Tournament.findByIdAndUpdate(tournamentId, {
     status: 'inProgress',
     $set: { games: matches.gameIds }
   });
   
   res.json({ 
     success: true, 
     message: 'Turnuva başarıyla başlatıldı',
     matches: matches.count
   });
   
 } catch (error) {
   console.error('Turnuva başlatma hatası:', error);
   res.status(500).json({ error: 'Turnuva başlatılırken bir hata oluştu' });
 }
});

// Turnuva eşleşmeleri oluşturma fonksiyonu
async function createTournamentMatches(tournament) {
 try {
   // Katılımcıları karıştır
   const shuffledParticipants = [...tournament.participants].sort(() => Math.random() - 0.5);
   
   // Eşleşmeleri oluştur
   const matchCount = Math.floor(shuffledParticipants.length / 2);
   const gameIds = [];
   
   for (let i = 0; i < matchCount; i++) {
     const whitePlayer = shuffledParticipants[i * 2];
     const blackPlayer = shuffledParticipants[i * 2 + 1];
     
     // Yeni oyun belgesi oluştur
     const newGame = new Game({
       whitePlayer: whitePlayer,
       blackPlayer: blackPlayer,
       timeControl: tournament.timeControl,
       startTime: new Date(),
       tournamentId: tournament._id
     });
     
     const savedGame = await newGame.save();
     gameIds.push(savedGame._id);
   }
   
   return { count: matchCount, gameIds };
 } catch (error) {
   console.error('Turnuva eşleşmeleri oluşturma hatası:', error);
   throw error;
 }
}

// Geçmiş oyunları getir
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

// Sıralama verilerini getir
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

// Ana sayfa ve diğer sayfalar
app.get('/', (req, res) => {
 res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/siralama', isAuthenticated, (req, res) => {
 res.sendFile(path.join(__dirname, '../public/siralama.html'));
});

app.get('/gecmis-oyunlar', isAuthenticated, (req, res) => {
 res.sendFile(path.join(__dirname, '../public/gecmis-oyunlar.html'));
});

// 404 - Sayfa bulunamadı
app.use((req, res, next) => {
  // API istekleri için 404 JSON yanıtı
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint bulunamadı' });
  }
  
  // Statik dosya istekleri dışındaki HTML sayfaları için 404 sayfası
  if (!req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg)$/)) {
    return res.status(404).sendFile(path.join(__dirname, '../public/404.html'));
  }
  
  next();
});

// Genel hata yakalama
app.use((err, req, res, next) => {
  console.error('Server hatası:', err);
  
  // API istekleri için JSON hata yanıtı
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Sunucu hatası', details: process.env.NODE_ENV === 'development' ? err.message : null });
  }
  
  // HTML sayfaları için 500 sayfası
  res.status(500).sendFile(path.join(__dirname, '../public/500.html'));
});

// Socket.io bağlantısını kur
setupSocketIO(io);

// Debug bilgilerini düzenli aralıklarla logla
let socketStats = { activeGames: 0, waitingPlayers: 0, userSockets: 0 };

setInterval(() => {
 console.log("------- SUNUCU DURUMU -------");
 try {
   socketStats = require('./socket-handler').getStats();
 } catch (error) {
   console.error("İstatistik alma hatası:", error.message);
 }
 
 console.log(`Aktif oyunlar: ${socketStats.activeGames}`);
 console.log(`Bekleyen oyuncular: ${socketStats.waitingPlayers}`);
 console.log(`Socket-Kullanıcı eşleşmeleri: ${socketStats.userSockets}`);
 console.log("-----------------------------");
}, 60000); // Her 1 dakikada bir

// Genel hata yakalama
process.on('uncaughtException', (err) => {
 console.error('Yakalanmamış İstisna:', err);
 // Kritik hatalar oluştuğunda uygulamayı yeniden başlatın
 if (err.message.includes('FATAL') || err.message.includes('CRITICAL')) {
   console.error('Kritik hata tespit edildi, uygulama yeniden başlatılıyor...');
   process.exit(1);
 }
});

process.on('unhandledRejection', (reason, promise) => {
 console.error('İşlenmeyen Reddetme:', reason);
});

// Graceful shutdown - SIGTERM ve SIGINT sinyallerini yakala
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
  console.log('Sunucu kapatılıyor...');
  
  // Aktif bağlantıları kapat
  server.close(() => {
    console.log('HTTP sunucusu kapatıldı');
    
    // MongoDB bağlantısını kapat
    mongoose.connection.close(false, () => {
      console.log('MongoDB bağlantısı kapatıldı');
      process.exit(0);
    });
  });
  
  // 10 saniye içinde kapanmazsa zorla kapat
  setTimeout(() => {
    console.error('Bağlantılar zamanında kapatılamadı, zorla kapatılıyor');
    process.exit(1);
  }, 10000);
}

// Sunucuyu başlat
server.listen(PORT, () => {
 console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
 console.log(`Ortam: ${process.env.NODE_ENV || 'development'}`);
});

// Modül dışa aktarımı
module.exports = { User, Game, Tournament, createFriendInvite };
