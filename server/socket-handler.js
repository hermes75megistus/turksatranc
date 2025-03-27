// Modül fonksiyonu - döngüsel bağımlılıkları önlemek için
module.exports = function(gameModule) {
  // Aktif oyuncular ve oyunlar için depo
  const waitingPlayers = [];
  const activeGames = new Map();
  const userSockets = new Map(); // Kullanıcı ID - Socket ID eşleşmesi
  const inviteGames = new Map(); // Davet ID - Oyun bilgisi eşleşmesi

  // Değişkenleri bağlamdan al
  let User, Game, Tournament, createGuestUser, createFriendInvite;

  if (gameModule) {
    User = gameModule.User;
    Game = gameModule.Game;
    Tournament = gameModule.Tournament;
    createGuestUser = gameModule.createGuestUser;
    createFriendInvite = gameModule.createFriendInvite;
  }

  // İstatistikleri döndüren fonksiyon
  const getStats = () => {
    return {
      activeGames: activeGames.size,
      waitingPlayers: waitingPlayers.length,
      userSockets: userSockets.size
    };
  };

  // Socket.io kurulumu
  const setupSocketIO = (io) => {
    // Modüller yüklenmemişse, dinamik olarak import et
    if (!User || !Game || !createGuestUser) {
      try {
        const server = require('./server');
        User = server.User;
        Game = server.Game;
        Tournament = server.Tournament;
        createGuestUser = server.createGuestUser;
        createFriendInvite = server.createFriendInvite;
      } catch (error) {
        console.error('Model importları yüklenemedi:', error);
        // Modüller yoksa, fonksiyona devam etmeyin
        return;
      }
    }

    // Socket kimlik doğrulama için middleware
    io.use(async (socket, next) => {
      try {
        // Session ve cookie bilgilerini kontrol et
        const cookies = socket.handshake.headers.cookie;
        console.log('Socket bağlantısı - cookies:', cookies ? 'Var' : 'Yok');
        
        // Auth bilgilerini kontrol et
        const sessionId = socket.handshake.auth.sessionId;
        const userId = socket.handshake.auth.userId;
        
        console.log(`Socket kimlik doğrulama bilgileri: sessionId=${sessionId ? 'Var' : 'Yok'}, userId=${userId || 'Yok'}`);
        
        // UserId varsa ve geçerliyse bu kullanıcıyı kullan
        if (userId) {
          try {
            const user = await User.findById(userId);
            if (user) {
              socket.userId = user._id;
              socket.username = user.username;
              socket.isGuest = user.isGuest || false;
              
              console.log(`Kullanıcı doğrulandı: ${user.username} (${user._id}), isGuest: ${socket.isGuest}`);
              
              // Socket ID ile kullanıcı eşleştir
              userSockets.set(user._id.toString(), socket.id);
              return next();
            }
          } catch (userError) {
            console.error('Kullanıcı doğrulama hatası:', userError);
          }
        }
        
        // Session ID varsa session store'dan kullanıcı kimliğini almayı dene
        if (sessionId && cookies) {
          try {
            // Bu örnekte basit bir session parser kullanıyoruz
            // Gerçek uygulamada daha karmaşık bir session parse etme işlemi gerekebilir
            console.log('Socket bağlantısı - sessionId ile doğrulama denenecek');
            
            // sessionId'den userId'yi çıkarmak için cookie parser gerekli
            // Bu sadece basit bir örnektir, gerçek uygulamada session store kullanılmalı
            const cookieParser = require('cookie-parser');
            const parseSignedCookie = cookieParser.signedCookie;
            const parseCookie = cookieParser.JSONCookie;
            
            // Burada session store'dan userId çekilmeli
            // Bu örnekte yapılmamıştır
          } catch (sessionError) {
            console.error('Session doğrulama hatası:', sessionError);
          }
        }
        
        // Doğrulanmış kullanıcı bulunamadıysa, misafir kullanıcı oluştur
        const guestUser = await createGuestUser();
        socket.userId = guestUser._id;
        socket.username = guestUser.username;
        socket.isGuest = true;
        
        // Socket ID ile kullanıcı eşleştir
        userSockets.set(guestUser._id.toString(), socket.id);
        console.log(`Misafir kullanıcı oluşturuldu: ${guestUser.username} (${guestUser._id})`);
        
        return next();
      } catch (error) {
        console.error('Socket kimlik doğrulama hatası:', error);
        return next(new Error('Kimlik doğrulama hatası'));
      }
    });

    io.on('connection', async (socket) => {
      console.log(`Yeni socket bağlantısı: ${socket.id}, Kullanıcı: ${socket.username || 'Bilinmiyor'}, UserId: ${socket.userId || 'Yok'}, isGuest: ${socket.isGuest}`);
      
      // Tüm socket hatalarını yakalama
      socket.on('error', (error) => {
        console.error('Socket hatası:', error);
      });
      
      // Kullanıcı kimliğini belirle
      socket.on('authenticate', async (userId) => {
        try {
          console.log(`Kimlik doğrulama isteği userId: ${userId}, socket.userId: ${socket.userId}`);
          
          // Kullanıcı zaten doğrulandıysa ve aynı kimlikse işleme gerek yok
          if (socket.userId && socket.userId.toString() === userId) {
            console.log('Kullanıcı zaten doğrulanmış, işlem atlanıyor.');
            return;
          }
          
          // Kullanıcıyı doğrula
          if (userId) {
            const user = await User.findById(userId);
            if (user) {
              console.log(`Kullanıcı bulundu: ${user.username}`);
              socket.userId = user._id;
              socket.username = user.username;
              socket.isGuest = user.isGuest || false;
              
              // Kullanıcı Socket Map'e kaydet
              userSockets.set(user._id.toString(), socket.id);
              console.log(`Kullanıcı socket eşleşmesi güncellendi: ${user.username} -> ${socket.id}`);
              return;
            }
          }
          
          // Kullanıcı bulunamadıysa ve socket.userId yoksa, misafir kullanıcı oluştur
          if (!socket.userId) {
            const guestUser = await createGuestUser();
            socket.userId = guestUser._id;
            socket.username = guestUser.username;
            socket.isGuest = true;
            
            // Kullanıcı Socket Map'e kaydet
            userSockets.set(guestUser._id.toString(), socket.id);
            console.log(`Misafir kullanıcı oluşturuldu: ${guestUser.username}`);
          }
        } catch (error) {
          console.error('Kimlik doğrulama hatası:', error);
        }
      });
    
      // Oyuncu eşleşme için arama
      socket.on('find_match', async (timeControl) => {
        console.log(`Eşleşme isteği - Socket: ${socket.id}, Kullanıcı: ${socket.username || 'Bilinmiyor'}, isGuest: ${socket.isGuest}`);
        
        if (!socket.userId) {
          console.log('Eşleşme hatası: Kullanıcı kimliği yok');
          socket.emit('error', { message: 'Kullanıcı kimliği bulunamadı, lütfen sayfayı yenileyin' });
          return;
        }
        
        try {
          // Kullanıcı bilgisini doğrula
          const user = await User.findById(socket.userId);
          
          if (!user) {
            console.log('Eşleşme hatası: Kullanıcı bulunamadı:', socket.userId);
            socket.emit('error', { message: 'Kullanıcı bulunamadı, lütfen sayfayı yenileyin' });
            return;
          }
          
          // Geçerli bir sayı olduğundan emin ol
          timeControl = parseInt(timeControl) || 15;
          console.log(`Eşleşme parametreleri - Kullanıcı: ${user.username}, Süre: ${timeControl}dk, ELO: ${user.elo}, isGuest: ${user.isGuest}`);
          
          // Önce mevcut bekleme listesinden bu kullanıcıyı kaldır
          const existingIndex = waitingPlayers.findIndex(p => p.id.toString() === socket.userId.toString());
          if (existingIndex !== -1) {
            waitingPlayers.splice(existingIndex, 1);
            console.log(`Kullanıcı bekleme listesinden kaldırıldı: ${user.username}`);
          }
          
          // Bekleme listesini kontrol et - aynı zamanlı eşleşme
          console.log(`Bekleme listesi durumu: ${waitingPlayers.length} oyuncu bekliyor`);
          
          // Bu kullanıcı için bir eşleşme bul (aynı süre kontrolüne sahip kullanıcı)
          const waitingPlayerIndex = waitingPlayers.findIndex(p => {
            return p.id.toString() !== socket.userId.toString() &&  // kendisiyle eşleşmesin
                   p.timeControl === timeControl;  // aynı süre kontrolü
          });
          
          if (waitingPlayerIndex !== -1) {
            // Eşleşme bulundu
            const opponent = waitingPlayers.splice(waitingPlayerIndex, 1)[0];
            const gameId = Math.random().toString(36).substring(2, 15);
            
            console.log(`Eşleşme bulundu! ${user.username} ve ${opponent.username} arasında, süre: ${timeControl}dk`);
            
            // Rastgele renk ataması (beyaz/siyah)
            const randomBoolean = Math.random() < 0.5;
            const whitePlayerId = randomBoolean ? socket.userId : opponent.id;
            const blackPlayerId = randomBoolean ? opponent.id : socket.userId;
            
            const whitePlayer = await User.findById(whitePlayerId);
            const blackPlayer = await User.findById(blackPlayerId);
            
            if (!whitePlayer || !blackPlayer) {
              console.log('Eşleşme başarısız: Oyunculardan biri bulunamadı');
              socket.emit('error', { message: 'Eşleşme başarısız' });
              return;
            }
            
            // Milisaniye cinsinden zaman
            const timeInMilliseconds = timeControl * 60 * 1000;
            
            // Yeni oyun belgesi oluştur
            const newGame = new Game({
              whitePlayer: whitePlayerId,
              blackPlayer: blackPlayerId,
              timeControl: timeControl,
              startTime: new Date()
            });
            
            await newGame.save();
            console.log('Yeni oyun veritabanına kaydedildi:', newGame._id);
            
            // Aktif oyun bilgisi
            activeGames.set(gameId, {
              id: gameId,
              dbId: newGame._id,
              players: [
                { id: whitePlayerId, color: 'white', username: whitePlayer.username, isGuest: whitePlayer.isGuest },
                { id: blackPlayerId, color: 'black', username: blackPlayer.username, isGuest: blackPlayer.isGuest }
              ],
              fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
              pgn: '',
              moves: [],
              timeControl: timeControl,
              clocks: {
                [whitePlayerId.toString()]: timeInMilliseconds,
                [blackPlayerId.toString()]: timeInMilliseconds
              },
              lastMoveTime: Date.now(),
              currentTurn: 'white',
              messages: [],
              isFriendGame: false,
              tournamentId: null
            });
            
            // Her iki oyuncuya da eşleşme bilgisini gönder
            const whiteSocketId = userSockets.get(whitePlayerId.toString());
            const blackSocketId = userSockets.get(blackPlayerId.toString());
            
            console.log('Eşleşme bilgisi gönderiliyor:');
            console.log(`Beyaz (${whitePlayer.username}) -> Socket: ${whiteSocketId}`);
            console.log(`Siyah (${blackPlayer.username}) -> Socket: ${blackSocketId}`);
            
            if (whiteSocketId) {
              io.to(whiteSocketId).emit('match_found', { 
                gameId, 
                color: 'white',
                timeControl: timeControl,
                opponent: blackPlayer.username
              });
            }
            
            if (blackSocketId) {
              io.to(blackSocketId).emit('match_found', { 
                gameId, 
                color: 'black',
                timeControl: timeControl,
                opponent: whitePlayer.username
              });
            }
            
            console.log(`Eşleşme oluşturuldu: ${gameId}, oyuncular: ${whitePlayer.username} ve ${blackPlayer.username}, süre: ${timeControl} dakika`);
          } else {
            // Eşleşme bulunamadı, bekleme listesine ekle
            waitingPlayers.push({ 
              id: socket.userId, 
              joinedAt: Date.now(),
              timeControl: timeControl,
              elo: user.elo,
              username: user.username,
              isGuest: user.isGuest
            });
            socket.emit('waiting');
            console.log(`Oyuncu bekleme listesine eklendi: ${user.username} - Süre: ${timeControl}dk - Bekleyen oyuncu sayısı: ${waitingPlayers.length}`);
            console.log('Bekleme listesi:', waitingPlayers.map(p => p.username));
          }
        } catch (error) {
          console.error('Eşleşme oluşturma hatası:', error);
          socket.emit('error', { message: 'Eşleşme bulunurken bir hata oluştu' });
        }
      });

      // Arkadaş daveti ile oyun kurma
      socket.on('join_friend_game', async ({ inviteId }) => {
        console.log(`Arkadaş daveti ile oyun isteği - Socket: ${socket.id}, Davet: ${inviteId}`);
        
        if (!socket.userId) {
          socket.emit('error', { message: 'Kullanıcı kimliği bulunamadı' });
          return;
        }
        
        try {
          // Kullanıcı bilgisini doğrula
          const joiningUser = await User.findById(socket.userId);
          
          if (!joiningUser) {
            console.log('Oyun kurma hatası: Kullanıcı bulunamadı:', socket.userId);
            socket.emit('error', { message: 'Kullanıcı bulunamadı, lütfen sayfayı yenileyin' });
            return;
          }
          
          // Daveti doğrula
          const creatorUser = await User.findOne({
            'friendInvites.inviteId': inviteId,
            'friendInvites.expires': { $gte: new Date() } // Süresi dolmamış davetler
          });
          
          if (!creatorUser) {
            console.log('Oyun kurma hatası: Davet bulunamadı veya süresi dolmuş:', inviteId);
            socket.emit('error', { message: 'Davet bulunamadı veya süresi dolmuş' });
            return;
          }
          
          // Kendisi ile oyun kurmasını engelle
          if (creatorUser._id.toString() === socket.userId.toString()) {
            console.log('Oyun kurma hatası: Kullanıcı kendi daveti ile oyun kuramaz');
            socket.emit('error', { message: 'Kendi davetinizle oyun kuramazsınız' });
            return;
          }
          
          // İlgili daveti bul
          const invite = creatorUser.friendInvites.find(inv => inv.inviteId === inviteId);
          
if (!invite) {
            console.log('Oyun kurma hatası: Davet detayları bulunamadı:', inviteId);
            socket.emit('error', { message: 'Davet detayları bulunamadı' });
            return;
          }
          
          // Davet ID'si ile bir oyun zaten kurulmuş mu?
          if (inviteGames.has(inviteId)) {
            console.log('Oyun kurma hatası: Bu davete ait aktif bir oyun zaten var:', inviteId);
            socket.emit('error', { message: 'Bu davete ait aktif bir oyun zaten var' });
            return;
          }
          
          // Süre kontrolünü al
          const timeControl = invite.timeControl || 15;
          
          // Oyun ID'si oluştur
          const gameId = Math.random().toString(36).substring(2, 15);
          
          // Oyun kurucusu her zaman beyaz olsun
          const whitePlayerId = creatorUser._id;
          const blackPlayerId = socket.userId;
          
          // Oyun oluştur
          const timeInMilliseconds = timeControl * 60 * 1000;
          
          // Yeni oyun belgesi oluştur
          const newGame = new Game({
            whitePlayer: whitePlayerId,
            blackPlayer: blackPlayerId,
            timeControl: timeControl,
            startTime: new Date(),
            inviteId: inviteId,
            isFriendGame: true
          });
          
          await newGame.save();
          console.log('Yeni arkadaş oyunu veritabanına kaydedildi:', newGame._id);
          
          // Aktif oyun bilgisi
          activeGames.set(gameId, {
            id: gameId,
            dbId: newGame._id,
            players: [
              { id: whitePlayerId, color: 'white', username: creatorUser.username, isGuest: creatorUser.isGuest },
              { id: blackPlayerId, color: 'black', username: joiningUser.username, isGuest: joiningUser.isGuest }
            ],
            fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            pgn: '',
            moves: [],
            timeControl: timeControl,
            clocks: {
              [whitePlayerId.toString()]: timeInMilliseconds,
              [blackPlayerId.toString()]: timeInMilliseconds
            },
            lastMoveTime: Date.now(),
            currentTurn: 'white',
            messages: [],
            isFriendGame: true,
            inviteId: inviteId
          });
          
          // Davet ID'si ile oyun eşleştir
          inviteGames.set(inviteId, gameId);
          
          // Her iki oyuncuya da eşleşme bilgisini gönder
          const whiteSocketId = userSockets.get(whitePlayerId.toString());
          const blackSocketId = userSockets.get(blackPlayerId.toString());
          
          console.log('Arkadaş oyunu bilgisi gönderiliyor:');
          console.log(`Beyaz (${creatorUser.username}) -> Socket: ${whiteSocketId}`);
          console.log(`Siyah (${joiningUser.username}) -> Socket: ${blackSocketId}`);
          
          if (whiteSocketId) {
            io.to(whiteSocketId).emit('match_found', { 
              gameId, 
              color: 'white',
              timeControl: timeControl,
              opponent: joiningUser.username,
              isFriendGame: true
            });
          }
          
          if (blackSocketId) {
            io.to(blackSocketId).emit('match_found', { 
              gameId, 
              color: 'black',
              timeControl: timeControl,
              opponent: creatorUser.username,
              isFriendGame: true
            });
          }
          
          console.log(`Arkadaş oyunu oluşturuldu: ${gameId}, oyuncular: ${creatorUser.username} ve ${joiningUser.username}, süre: ${timeControl} dakika`);
          
        } catch (error) {
          console.error('Arkadaş oyunu kurma hatası:', error);
          socket.emit('error', { message: 'Arkadaş oyunu kurulurken bir hata oluştu' });
        }
      });

      // Hamle yapma olayı
      socket.on('move', async ({ gameId, move, fen, pgn }) => {
        console.log(`Hamle isteği - Socket: ${socket.id}, Oyun: ${gameId}, Hamle: ${move.from} -> ${move.to}`);
        
        if (!socket.userId) {
          socket.emit('error', { message: 'Kullanıcı kimliği bulunamadı' });
          return;
        }
        
        const game = activeGames.get(gameId);
        if (!game) {
          console.log('Oyun bulunamadı:', gameId);
          socket.emit('error', { message: 'Oyun bulunamadı' });
          return;
        }
        
        // Hamle yapma sırasını kontrol et
        const player = game.players.find(p => p.id.toString() === socket.userId.toString());
        if (!player) {
          console.log('Bu oyuncu bu oyuna ait değil');
          socket.emit('error', { message: 'Bu oyuna katılma yetkiniz yok' });
          return;
        }
        
        if ((game.currentTurn === 'white' && player.color !== 'white') || 
            (game.currentTurn === 'black' && player.color !== 'black')) {
          console.log('Sıra bu oyuncuda değil');
          socket.emit('error', { message: 'Şu anda hamle sırası sizde değil' });
          return;
        }
        
        try {
          const now = Date.now();
          const timeDiff = now - game.lastMoveTime;
          
          // Oyun durumunu güncelle
          game.moves.push({...move, timestamp: new Date()});
          game.fen = fen;
          game.pgn = pgn;
          
          // Veritabanındaki oyunu güncelle
          await Game.findByIdAndUpdate(game.dbId, {
            fen: fen,
            pgn: pgn,
            $push: { moves: {...move, timestamp: new Date()} }
          });
          
          // Mevcut oyuncunun saatini güncelle
          game.clocks[socket.userId.toString()] -= timeDiff;
          
          // Sırayı değiştir
          game.currentTurn = player.color === 'white' ? 'black' : 'white';
          game.lastMoveTime = now;
          
          // Rakibe bildir
          const opponent = game.players.find(p => p.id.toString() !== socket.userId.toString());
          if (opponent) {
            const opponentSocketId = userSockets.get(opponent.id.toString());
            console.log(`Rakibe hamle bildiriliyor: ${opponent.username} -> Socket: ${opponentSocketId}`);
            
            if (opponentSocketId) {
              io.to(opponentSocketId).emit('opponent_move', { 
                move, 
                fen, 
                pgn,
                whiteTime: game.clocks[game.players.find(p => p.color === 'white').id.toString()],
                blackTime: game.clocks[game.players.find(p => p.color === 'black').id.toString()]
              });
            }
          }
        } catch (error) {
          console.error('Hamle işleme hatası:', error);
          socket.emit('error', { message: 'Hamle işlenirken bir hata oluştu' });
        }
      });

      // Oyun bitti
      socket.on('game_over', async ({ gameId, result }) => {
        console.log(`Oyun bitti isteği - Socket: ${socket.id}, Oyun: ${gameId}, Sonuç: ${result}`);
        
        if (!socket.userId) {
          socket.emit('error', { message: 'Kullanıcı kimliği bulunamadı' });
          return;
        }
        
        const game = activeGames.get(gameId);
        if (!game) {
          console.log('Oyun bitirme hatası: Oyun bulunamadı');
          socket.emit('error', { message: 'Oyun bulunamadı' });
          return;
        }
        
        try {
          const player = game.players.find(p => p.id.toString() === socket.userId.toString());
          if (!player) {
            console.log('Bu oyuncu bu oyuna ait değil');
            socket.emit('error', { message: 'Bu oyuna katılma yetkiniz yok' });
            return;
          }
          
          // Oyun durumunu güncelle
          let gameResult;
          let whitePlayerResult;
          let blackPlayerResult;
          
          if (result === 'checkmate') {
            // Şah mat - hamle yapan oyuncu kazandı
            gameResult = player.color;
            whitePlayerResult = player.color === 'white' ? 'win' : 'loss';
            blackPlayerResult = player.color === 'white' ? 'loss' : 'win';
          } else if (result === 'draw') {
            // Berabere
            gameResult = 'draw';
            whitePlayerResult = 'draw';
            blackPlayerResult = 'draw';
          } else if (result === 'resignation') {
            // İstifa - teslim olan oyuncu kaybetti
            gameResult = player.color === 'white' ? 'black' : 'white';
            whitePlayerResult = player.color === 'white' ? 'loss' : 'win';
            blackPlayerResult = player.color === 'white' ? 'win' : 'loss';
          } else if (result === 'timeout') {
            // Süre doldu - süre aşımı yapan oyuncu kaybetti
            gameResult = player.color === 'white' ? 'black' : 'white';
            whitePlayerResult = player.color === 'white' ? 'loss' : 'win';
            blackPlayerResult = player.color === 'white' ? 'win' : 'loss';
          }
          
          // Veritabanındaki oyunu güncelle
          await Game.findByIdAndUpdate(game.dbId, {
            result: gameResult,
            endTime: new Date()
          });
          
          // ELO hesaplama ve kullanıcı istatistiklerini güncelle
          const whitePlayer = await User.findById(game.players.find(p => p.color === 'white').id);
          const blackPlayer = await User.findById(game.players.find(p => p.color === 'black').id);
          
          if (!whitePlayer || !blackPlayer) {
            console.log('Oyun sonu işleme hatası: Oyunculardan biri bulunamadı');
            socket.emit('error', { message: 'Oyuncular bulunamadı' });
            return;
          }
          
          let newWhiteElo = whitePlayer.elo;
          let newBlackElo = blackPlayer.elo;
          
          try {
            // Misafir kullanıcıları istatistik güncellemeden hariç tut
            if (!whitePlayer.isGuest && !blackPlayer.isGuest) {
              // Basit ELO hesaplama
              const kFactor = 32; // ELO değişim faktörü
              
              // Beklenen sonuçlar
              const expectedWhite = 1 / (1 + Math.pow(10, (blackPlayer.elo - whitePlayer.elo) / 400));
              const expectedBlack = 1 / (1 + Math.pow(10, (whitePlayer.elo - blackPlayer.elo) / 400));
              
              // Gerçek sonuçlar
              let actualWhite, actualBlack;
              
              if (gameResult === 'white') {
                actualWhite = 1;
                actualBlack = 0;
              } else if (gameResult === 'black') {
                actualWhite = 0;
                actualBlack = 1;
              } else {
                // Berabere
                actualWhite = 0.5;
                actualBlack = 0.5;
              }
              
              // Arkadaş oyunları için daha düşük k faktörü kullan
              const adjustedKFactor = game.isFriendGame ? kFactor / 2 : kFactor;
              
              // Yeni ELO puanları
              newWhiteElo = Math.round(whitePlayer.elo + adjustedKFactor * (actualWhite - expectedWhite));
              newBlackElo = Math.round(blackPlayer.elo + adjustedKFactor * (actualBlack - expectedBlack));
              
              // Beyaz oyuncuyu güncelle - misafir olmayan oyuncular için
              if (!whitePlayer.isGuest) {
                const whiteUpdate = { elo: newWhiteElo, $inc: { gamesPlayed: 1 } };
                if (whitePlayerResult === 'win') whiteUpdate.$inc.wins = 1;
                else if (whitePlayerResult === 'loss') whiteUpdate.$inc.losses = 1;
                else whiteUpdate.$inc.draws = 1;
                
                await User.findByIdAndUpdate(whitePlayer._id, whiteUpdate);
              }
              
              // Siyah oyuncuyu güncelle - misafir olmayan oyuncular için
              if (!blackPlayer.isGuest) {
                const blackUpdate = { elo: newBlackElo, $inc: { gamesPlayed: 1 } };
                if (blackPlayerResult === 'win') blackUpdate.$inc.wins = 1;
                else if (blackPlayerResult === 'loss') blackUpdate.$inc.losses = 1;
                else blackUpdate.$inc.draws = 1;
                
                await User.findByIdAndUpdate(blackPlayer._id, blackUpdate);
              }
              
              // Eğer turnuva oyunu ise turnuva sonuçlarını güncelle
              if (game.tournamentId) {
                await updateTournamentResults(game.tournamentId, {
                  whiteId: whitePlayer._id,
                  blackId: blackPlayer._id,
                  result: gameResult
                });
              }
            }
          } catch (updateError) {
            console.error('ELO ve istatistik güncelleme hatası:', updateError);
          }
          
          // İki oyuncuya da bilgi gönder
          game.players.forEach(p => {
            const playerSocketId = userSockets.get(p.id.toString());
            if (playerSocketId) {
              // ELO değişimini hesapla
              const player = p.color === 'white' ? whitePlayer : blackPlayer;
              const initialElo = player.elo;
              const newElo = p.color === 'white' ? newWhiteElo : newBlackElo;
              const eloChange = player.isGuest ? 0 : (newElo - initialElo);
              
              console.log(`Oyun sonu bilgisi gönderiliyor: ${player.username} -> Socket: ${playerSocketId}`);
              console.log(`ELO değişimi: ${initialElo} -> ${newElo} (${eloChange > 0 ? '+' : ''}${eloChange})`);
              
              io.to(playerSocketId).emit('game_ended', { 
                result: gameResult,
                playerColor: p.color,
                eloChange: eloChange,
                isFriendGame: game.isFriendGame
              });
            }
          });
          
          console.log(`Oyun bitti (${gameId}): ${gameResult}`);
          
          // Eğer bu bir arkadaş oyunu ise davet eşleşmesini kaldır
          if (game.inviteId) {
            inviteGames.delete(game.inviteId);
          }
          
          // Aktif oyunlar listesinden kaldır
          activeGames.delete(gameId);
        } catch (error) {
          console.error('Oyun bitirme hatası:', error);
          socket.emit('error', { message: 'Oyun sonlandırılırken bir hata oluştu' });
        }
      });
      
      // Turnuva sonuçlarını güncelleme fonksiyonu
      async function updateTournamentResults(tournamentId, gameInfo) {
        try {
          const tournament = await Tournament.findById(tournamentId);
          if (!tournament) return;
          
          // Beyaz oyuncu puanları
          const whiteStanding = tournament.standings.find(s => 
            s.playerId.toString() === gameInfo.whiteId.toString()
          );
          
          // Siyah oyuncu puanları
          const blackStanding = tournament.standings.find(s => 
            s.playerId.toString() === gameInfo.blackId.toString()
          );
          
          if (!whiteStanding || !blackStanding) return;
          
          // Oyun sonucuna göre güncelleme
          if (gameInfo.result === 'white') {
            // Beyaz kazandı
            whiteStanding.points += 1;
            whiteStanding.wins += 1;
            blackStanding.losses += 1;
          } else if (gameInfo.result === 'black') {
            // Siyah kazandı
            blackStanding.points += 1;
            blackStanding.wins += 1;
            whiteStanding.losses += 1;
          } else {
            // Berabere
            whiteStanding.points += 0.5;
            blackStanding.points += 0.5;
            whiteStanding.draws += 1;
            blackStanding.draws += 1;
          }
          
          // Oyun sayılarını güncelle
          whiteStanding.gamesPlayed += 1;
          blackStanding.gamesPlayed += 1;
          
          // Turnuvayı güncelle
          await Tournament.findByIdAndUpdate(tournamentId, {
            $set: { standings: tournament.standings }
          });
          
          // Eğer tüm oyunlar tamamlandıysa turnuvayı bitir
          const completedGames = await Game.countDocuments({
            tournamentId: tournamentId,
            result: { $ne: 'ongoing' }
          });
          
          // Beklenen oyun sayısı - turnuva formatına göre değişebilir
          const expectedGameCount = Math.floor(tournament.participants.length / 2) * tournament.rounds;
          
          if (completedGames >= expectedGameCount) {
            await Tournament.findByIdAndUpdate(tournamentId, {
              status: 'completed',
              endTime: new Date()
            });
          }
          
        } catch (error) {
          console.error('Turnuva sonuçları güncelleme hatası:', error);
        }
      }
      
      // Süre aşımı
      socket.on('time_out', async ({ gameId }) => {
        console.log(`Süre aşımı bildirimi - Socket: ${socket.id}, Oyun: ${gameId}`);
        
        if (!socket.userId) {
          socket.emit('error', { message: 'Kullanıcı kimliği bulunamadı' });
          return;
        }
        
        const game = activeGames.get(gameId);
        if (!game) {
          console.log('Oyun bulunamadı:', gameId);
          socket.emit('error', { message: 'Oyun bulunamadı' });
          return;
        }
        
        try {
          const player = game.players.find(p => p.id.toString() === socket.userId.toString());
          if (!player) {
            console.log('Bu oyuncu bu oyuna ait değil');
            socket.emit('error', { message: 'Bu oyuna katılma yetkiniz yok' });
            return;
          }
          
          // Süre kontrolü için güvenlik kontrolü
          const playerClock = game.clocks[socket.userId.toString()];
          if (playerClock > 0) {
            console.log('Geçersiz süre aşımı bildirimi: Oyuncunun hala zamanı var:', playerClock);
            socket.emit('error', { message: 'Geçersiz süre aşımı bildirimi' });
            return;
          }
          
          const result = player.color === 'white' ? 'black' : 'white'; // Süre dolduğu için kaybetti
          
          // Oyunu bitir
          socket.emit('game_over', { gameId, result: 'timeout' });
        } catch (error) {
          console.error('Süre aşımı hatası:', error);
          socket.emit('error', { message: 'Süre aşımı işlenirken bir hata oluştu' });
        }
      });

      // Sohbet mesajı
      socket.on('send_message', ({ gameId, message }) => {
        console.log(`Sohbet mesajı - Socket: ${socket.id}, Oyun: ${gameId}, Mesaj: "${message.substring(0, 20)}${message.length > 20 ? '...' : ''}"`);
        
        if (!socket.userId) {
          socket.emit('error', { message: 'Kullanıcı kimliği bulunamadı' });
          return;
        }
        
        const game = activeGames.get(gameId);
        if (!game) {
          console.log('Oyun bulunamadı:', gameId);
          socket.emit('error', { message: 'Oyun bulunamadı' });
          return;
        }
        
        const player = game.players.find(p => p.id.toString() === socket.userId.toString());
        if (!player) {
          console.log('Bu oyuncu bu oyuna ait değil');
          socket.emit('error', { message: 'Bu oyuna katılma yetkiniz yok' });
          return;
        }
        
        // Mesaj içerik kontrolü
        if (!message || message.trim() === '' || message.length > 500) {
          socket.emit('error', { message: 'Geçersiz mesaj' });
          return; // Boş veya çok uzun mesajları reddet
        }
        
        // Mesajı XSS saldırılarına karşı temizle
        const sanitizedMessage = message
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .trim();
        
        // Mesajı oyunun sohbet geçmişine ekle
        const chatMessage = {
          sender: player.color,
          senderName: player.username,
          text: sanitizedMessage,
          time: new Date().toISOString()
        };
        
        game.messages.push(chatMessage);
        
        // Her iki oyuncuya da gönder
        game.players.forEach(p => {
          const playerSocketId = userSockets.get(p.id.toString());
          if (playerSocketId) {
            io.to(playerSocketId).emit('chat_message', chatMessage);
          }
        });
      });

      // Bağlantı kesilince
      socket.on('disconnect', () => {
        console.log(`Bağlantı kesildi: ${socket.id}, Kullanıcı: ${socket.username || 'Bilinmiyor'}`);
        
        if (socket.userId) {
          // Bekleme listesinden kaldır
          const waitingIndex = waitingPlayers.findIndex(p => p.id.toString() === socket.userId.toString());
          if (waitingIndex !== -1) {
            console.log(`Kullanıcı bekleme listesinden çıkarıldı: ${waitingPlayers[waitingIndex].username}`);
            waitingPlayers.splice(waitingIndex, 1);
          }
          
          // Aktif oyunları işle
          for (const [gameId, game] of activeGames.entries()) {
            const playerIndex = game.players.findIndex(p => p.id.toString() === socket.userId.toString());
            if (playerIndex !== -1) {
              const player = game.players[playerIndex];
              const opponent = game.players.find(p => p.id.toString() !== socket.userId.toString());
              
              console.log(`Aktif oyuncu bağlantısı kesildi: ${player.username}, Oyun: ${gameId}`);
              
              if (opponent) {
                const opponentSocketId = userSockets.get(opponent.id.toString());
                if (opponentSocketId) {
                  console.log(`Rakibe bağlantı kesinti bildirimi: ${opponent.username}`);
                  io.to(opponentSocketId).emit('opponent_disconnected');
                }
              }
              
              // Eğer veritabanında kaydedilmiş bir oyunsa, sonuç güncelle
              if (game.dbId) {
                const winnerColor = socket.userId === game.players.find(p => p.color === 'white').id ? 'black' : 'white';
                Game.findByIdAndUpdate(game.dbId, {
                  result: winnerColor,
                  endTime: new Date()
                }).catch(err => console.error('Oyun güncelleme hatası:', err));
                
                console.log(`Oyun sonucu güncellendi: ${gameId}, Kazanan: ${winnerColor}`);
              }
              
              // Davet oyunu ise davet eşleşmesini kaldır
              if (game.inviteId) {
                inviteGames.delete(game.inviteId);
              }
              
              activeGames.delete(gameId);
            }
          }
          
          // Socket-User eşleşmesini kaldır
          userSockets.delete(socket.userId.toString());
        }
      });
    });
  };

  return {
    setupSocketIO,
    getStats
  };
};
