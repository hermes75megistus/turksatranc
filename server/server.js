// This is the critical part where the ActiveGames is correctly initialized
// Insert this in the socket.on('find_match') handler where we left off

        // Yeni oyun belgesi oluştur
        const newGame = new Game({
          whitePlayer: whitePlayerId,
          blackPlayer: blackPlayerId,
          timeControl: timeControl,
          startTime: new Date()
        });
        
        await newGame.save();
        console.log('Yeni oyun veritabanına kaydedildi:', newGame._id);
        
        // Aktif oyun bilgisi - DÜZELTILMIŞ YAPLANDIRMA
        activeGames.set(gameId, {
          id: gameId,
          dbId: newGame._id,
          players: [
            { id: whitePlayerId, color: 'white', username: whitePlayer.username },
            { id: blackPlayerId, color: 'black', username: blackPlayer.username }
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
          messages: []
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
          username: user.username
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

  // Hamle yapma
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
          
          // Yeni ELO puanları
          newWhiteElo = Math.round(whitePlayer.elo + kFactor * (actualWhite - expectedWhite));
          newBlackElo = Math.round(blackPlayer.elo + kFactor * (actualBlack - expectedBlack));
          
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
            eloChange: eloChange
          });
        }
      });
      
      console.log(`Oyun bitti (${gameId}): ${gameResult}`);
      
      // Aktif oyunlar listesinden kaldır
      activeGames.delete(gameId);
    } catch (error) {
      console.error('Oyun bitirme hatası:', error);
      socket.emit('error', { message: 'Oyun sonlandırılırken bir hata oluştu' });
    }
  });

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
          
          activeGames.delete(gameId);
        }
      }
      
      // Socket-User eşleşmesini kaldır
      userSockets.delete(socket.userId.toString());
    }
  });
});

// Debug bilgilerini düzenli aralıklarla logla
setInterval(() => {
  console.log("------- SUNUCU DURUMU -------");
  console.log(`Aktif oyunlar: ${activeGames.size}`);
  console.log(`Bekleyen oyuncular: ${waitingPlayers.length}`);
  console.log(`Socket-Kullanıcı eşleşmeleri: ${userSockets.size}`);
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
