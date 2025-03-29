document.addEventListener('DOMContentLoaded', () => {
    // Socket bağlantısı ve kullanıcı bilgileri
    let socket = null;
    
    // Oyun durumu değişkenleri
    let board = null;
    let game = new Chess();
    let gameId = null;
    let playerColor = 'white';
    let currentGameState = 'idle'; // idle, waiting, playing, over
    let timeControl = 15; // Varsayılan süre kontrolü (dakika)
    let clocks = {
        white: 15 * 60 * 1000, // milisaniye cinsinden
        black: 15 * 60 * 1000
    };
    let clockInterval = null;
    let opponentName = '';
    let isFriendGame = false;
    
    // DOM elemanları
    const statusDiv = document.getElementById('status');
    const setupContainer = document.getElementById('setup-container');
    const gameContainer = document.getElementById('game-container');
    const timeOptions = document.querySelectorAll('.time-option');
    const startBtn = document.getElementById('start-btn');
    const friendBtn = document.getElementById('friend-btn');
    const resignBtn = document.getElementById('resign-btn');
    const newGameBtn = document.getElementById('new-game-btn');
    const boardContainer = document.getElementById('board-container');
    const pgnDisplay = document.getElementById('pgn-display');
    const whiteTimer = document.querySelector('.white-timer');
    const blackTimer = document.querySelector('.black-timer');
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const resultModal = document.getElementById('result-modal');
    const resultTitle = document.getElementById('result-title');
    const resultMessage = document.getElementById('result-message');
    const eloChangeValue = document.getElementById('elo-change-value');
    const resultNewGame = document.getElementById('result-new-game');
    const closeModal = document.querySelector('.close-modal');
    const playerName = document.getElementById('player-name');
    const opponentNameElement = document.getElementById('opponent-name');
    const usernameDisplay = document.getElementById('username-display');
    const eloDisplay = document.getElementById('elo-display');
    const logoutBtn = document.getElementById('logout-btn');
    const loginBtn = document.getElementById('login-btn');
    const registerBtn = document.getElementById('register-btn');
    
    // Arkadaş daveti modal elementleri
    const friendModal = document.getElementById('friend-modal');
    const friendInviteLink = document.getElementById('friend-invite-link');
    const copyFriendLinkBtn = document.getElementById('copy-friend-link');
    const closeFriendModal = document.getElementById('close-friend-modal');
    
const initializeSocket = function(userId) {
    console.log("Socket bağlantısı başlatılıyor, userId:", userId || "Yok");
    
    // socket.io bağlantısını başlat
    const socket = io({
        auth: {
            userId: userId
        },
        withCredentials: true // Cookie gönderimini aktif et
    });
    
    // Socket event listener'larını ayarla
    setupSocketListeners(socket);
    
    return socket;
};
    
    // Çerezden sessionId alma fonksiyonu
    function getSessionIdFromCookie() {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.startsWith('connect.sid=')) {
                return cookie.substring('connect.sid='.length);
            }
        }
        return '';
    }
    
    // Kullanıcı ID'sini sayfadan alma fonksiyonu
    function getUserIdFromPage() {
        const userElement = document.getElementById('username-display');
        return userElement ? userElement.getAttribute('data-id') : null;
    }
    
    // Socket olay dinleyicilerini ayarla
    function setupSocketListeners(socket) {
        socket.on('connect_error', (error) => {
            console.error('Bağlantı hatası:', error);
            
            if (error.message === 'authentication_error') {
                console.log('Kimlik doğrulama hatası, giriş yapmanız gerekiyor');
                statusDiv.innerHTML = 'Oynamak için giriş yapmalısınız. <a href="/giris" class="btn primary-btn small-btn">Giriş Yap</a>';
                startBtn.disabled = true;
                if (friendBtn) friendBtn.disabled = true;
            }
        });
        
        socket.on('match_found', matchFound);
        
        socket.on('waiting', () => {
            statusDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rakip bekleniyor...';
        });
        
        socket.on('opponent_move', opponentMove);
        
        socket.on('game_ended', (data) => {
            let resultMessage = '';
            
            // Sonuç ve oyuncu rengine göre mesajı belirle
            if (data.result === 'white') {
                resultMessage = data.playerColor === 'white' ? 'Kazandınız!' : 'Kaybettiniz!';
            } else if (data.result === 'black') {
                resultMessage = data.playerColor === 'black' ? 'Kazandınız!' : 'Kaybettiniz!';
            } else if (data.result === 'draw') {
                resultMessage = 'Oyun berabere bitti!';
            }
            
            // ELO değişimini göster
            const eloChange = data.eloChange;
            if (eloChange !== undefined) {
                eloChangeValue.textContent = eloChange > 0 ? `+${eloChange}` : eloChange;
                eloChangeValue.style.color = eloChange > 0 ? '#27ae60' : '#e74c3c';
                
                // ELO değişimi alanını göster
                const eloChangeContainer = document.getElementById('elo-change');
                eloChangeContainer.style.display = 'block';
            }
            
            // Arkadaş oyunu ise farklı mesaj göster
            if (data.isFriendGame) {
                resultMessage += ' (Arkadaş Oyunu)';
            }
            
            gameOver(resultMessage, data.result);
        });
        
        socket.on('opponent_disconnected', () => {
            gameOver('Rakip bağlantıyı kesti. Kazandınız!', 'disconnect');
        });
        
        socket.on('chat_message', (message) => {
            displayChatMessage(message);
        });
        
        socket.on('error', (data) => {
            console.error(`Sunucu hatası: ${data.message}`);
            
            if (data.redirect === '/giris') {
                statusDiv.innerHTML = `${data.message} <a href="/giris" class="btn primary-btn small-btn">Giriş Yap</a>`;
                startBtn.disabled = true;
                if (friendBtn) friendBtn.disabled = true;
            } else {
                alert(`Hata: ${data.message}`);
            }
        });
    }
    
    // Event listener'ları başlat
    function initializeEventListeners() {
        // Süre seçenekleri
        timeOptions.forEach(option => {
            option.addEventListener('click', () => {
                // Tüm seçeneklerden "selected" sınıfını kaldır
                timeOptions.forEach(opt => opt.classList.remove('selected'));
                // Tıklanan seçeneğe "selected" sınıfını ekle
                option.classList.add('selected');
                // Süre kontrolünü güncelle
                timeControl = parseInt(option.dataset.time, 10);
            });
        });
        
        // Sekme butonları
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                // Tüm butonlardan ve içeriklerden "active" sınıfını kaldır
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));
                
                // Tıklanan butona ve ilgili içeriğe "active" sınıfını ekle
                button.classList.add('active');
                const tabId = button.dataset.tab;
                document.getElementById(`${tabId}-container`).classList.add('active');
            });
        });
        
// Sohbet işlevselliği
       sendBtn.addEventListener('click', sendChatMessage);
       chatInput.addEventListener('keypress', (e) => {
           if (e.key === 'Enter') {
               sendChatMessage();
           }
       });
       
       // Oyun butonları
       startBtn.addEventListener('click', findMatch);
       resignBtn.addEventListener('click', resignGame);
       newGameBtn.addEventListener('click', newGame);
       resultNewGame.addEventListener('click', newGame);
       
       // Arkadaş daveti butonu
       if (friendBtn) {
           friendBtn.addEventListener('click', createFriendInvite);
       }
       
       // Arkadaş daveti modal butonları
       if (copyFriendLinkBtn) {
           copyFriendLinkBtn.addEventListener('click', copyFriendInviteLink);
       }
       
       if (closeFriendModal) {
           closeFriendModal.addEventListener('click', () => {
               friendModal.style.display = 'none';
           });
       }
       
       // Modal kapat butonu
       closeModal.addEventListener('click', () => {
           resultModal.style.display = 'none';
       });
       
       // Modal dışına tıklama
       window.addEventListener('click', (e) => {
           if (e.target === resultModal) {
               resultModal.style.display = 'none';
           }
           if (e.target === friendModal) {
               friendModal.style.display = 'none';
           }
       });
       
       // Çıkış butonu
       if (logoutBtn) {
           logoutBtn.addEventListener('click', logout);
       }
       
       // Giriş ve kayıt butonları
       if (loginBtn) {
           loginBtn.addEventListener('click', () => {
               window.location.href = '/giris';
           });
       }
       
       if (registerBtn) {
           registerBtn.addEventListener('click', () => {
               window.location.href = '/kayit';
           });
       }
       
       // URL'den davet ID kontrol et
       checkInviteInUrl();
   }
   
   // URL'den davet ID kontrol et
   function checkInviteInUrl() {
       const urlParams = new URLSearchParams(window.location.search);
       const inviteId = urlParams.get('invite');
       
       if (inviteId) {
           joinFriendGame(inviteId);
       }
   }
   
 // Kullanıcı bilgilerini yükle
async function loadUserInfo() {
    try {
        const response = await fetch('/api/kullanici', {
            credentials: 'include' // Çerezleri gönderir
        });
        
        if (!response.ok) {
            // Giriş yapılmamış, giriş butonlarını göster
            if (loginBtn && registerBtn) {
                loginBtn.style.display = 'inline-block';
                registerBtn.style.display = 'inline-block';
            }
            
            if (logoutBtn) {
                logoutBtn.style.display = 'none';
            }
            
            // Oyun butonlarını devre dışı bırak
            startBtn.disabled = true;
            if (friendBtn) friendBtn.style.display = 'none';
            
            statusDiv.innerHTML = 'Oynamak için <a href="/giris">giriş</a> yapmalısınız veya <a href="/kayit">hesap oluşturun</a>.';
            
            usernameDisplay.textContent = 'Ziyaretçi';
            eloDisplay.textContent = '-';
            playerName.textContent = 'Oyuncu';
            
            return;
        }
        
        const userData = await response.json();
           
          // Kullanıcı bilgilerini göster
        usernameDisplay.textContent = userData.username;
        eloDisplay.textContent = userData.elo;
        playerName.textContent = userData.username;
        
        // Kullanıcı kimliğini data attribute olarak sakla
        if (userData._id) {
            usernameDisplay.setAttribute('data-id', userData._id);
        }
        
        // Giriş yapılmış, çıkış butonunu göster
        if (loginBtn && registerBtn) {
            loginBtn.style.display = 'none';
            registerBtn.style.display = 'none';
        }
        
        if (logoutBtn) {
            logoutBtn.style.display = 'inline-block';
        }
        
        // Arkadaş daveti butonunu göster
        if (friendBtn) {
            friendBtn.style.display = 'inline-block';
        }
        
        console.log("Kullanıcı bilgisi yüklendi:", userData.username);
        
        // Socket'i kullanıcı kimliği ile başlat
        socket = initializeSocket(userData._id);
        
    } catch (error) {
        console.error('Kullanıcı bilgisi yükleme hatası:', error);
        
        // Hata durumunda giriş butonlarını göster
        if (loginBtn && registerBtn) {
            loginBtn.style.display = 'inline-block';
            registerBtn.style.display = 'inline-block';
        }
        
        if (logoutBtn) {
            logoutBtn.style.display = 'none';
        }
        
        // Oyun butonlarını devre dışı bırak
        startBtn.disabled = true;
        if (friendBtn) friendBtn.style.display = 'none';
        
        statusDiv.innerHTML = 'Oynamak için <a href="/giris">giriş</a> yapmalısınız veya <a href="/kayit">hesap oluşturun</a>.';
        
        usernameDisplay.textContent = 'Ziyaretçi';
        eloDisplay.textContent = '-';
        playerName.textContent = 'Oyuncu';
    }
}
   
   // Çıkış işlemi
   async function logout() {
       try {
           const response = await fetch('/api/cikis');
           
           if (response.ok) {
               const data = await response.json();
               if (data.success) {
                   window.location.href = data.redirect || '/giris';
               }
           } else {
               console.error('Çıkış hatası');
           }
       } catch (error) {
           console.error('Çıkış hatası:', error);
       }
   }
   
   // Arkadaş daveti oluştur
   async function createFriendInvite() {
       try {
           // Seçilen süre kontrolünü al
           const validTimeControl = timeControl || 15;
           
           const response = await fetch('/api/arkadasdaveti/olustur', {
               method: 'POST',
               headers: {
                   'Content-Type': 'application/json'
               },
               body: JSON.stringify({ timeControl: validTimeControl })
           });
           
           const data = await response.json();
           
           if (!response.ok) {
               alert(`Hata: ${data.error || 'Davet oluşturulamadı'}`);
               return;
           }
           
           // Davet linkini göster
           friendInviteLink.value = data.inviteUrl;
           friendModal.style.display = 'flex';
           
       } catch (error) {
           console.error('Arkadaş daveti oluşturma hatası:', error);
           alert('Arkadaş daveti oluşturulurken bir hata oluştu.');
       }
   }
   
   // Arkadaş davet linkini kopyala
   function copyFriendInviteLink() {
       friendInviteLink.select();
       document.execCommand('copy');
       copyFriendLinkBtn.innerHTML = '<i class="fas fa-check"></i>';
       setTimeout(() => {
           copyFriendLinkBtn.innerHTML = '<i class="fas fa-copy"></i>';
       }, 2000);
   }
   
   // Arkadaş oyununa katıl
   async function joinFriendGame(inviteId) {
       try {
           if (!socket) {
               statusDiv.innerHTML = 'Önce giriş yapmalısınız. <a href="/giris" class="btn primary-btn small-btn">Giriş Yap</a>';
               return;
           }
           
           // Önce davet bilgisini kontrol et
           const response = await fetch(`/api/arkadasdaveti/${inviteId}`);
           
           if (!response.ok) {
               const data = await response.json();
               alert(`Hata: ${data.error || 'Geçersiz davet'}`);
               return;
           }
           
           const inviteData = await response.json();
           
           // Eğer bu kullanıcı davet sahibi ise oyuna katılamaz
           if (inviteData.invite.creatorId === usernameDisplay.getAttribute('data-id')) {
               alert('Kendi davetinize katılamazsınız. Başka bir kullanıcı davetinizi kabul etmelidir.');
               return;
           }
           
           // Davet bilgisini göster
           statusDiv.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${inviteData.invite.createdBy} tarafından oluşturulan davete katılıyorsunuz... (${inviteData.invite.timeControl} dk)`;
           setupContainer.style.display = 'none';
           
           // Socket'e davet bilgisini gönder
           socket.emit('join_friend_game', { inviteId });
           
       } catch (error) {
           console.error('Arkadaş oyununa katılma hatası:', error);
           alert('Arkadaş oyununa katılırken bir hata oluştu.');
           setupContainer.style.display = 'flex';
           statusDiv.innerHTML = 'Oynamak için süre seçin ve eşleşme bulun';
       }
   }
   
   // Sohbet mesajı gönder
   function sendChatMessage() {
       const message = chatInput.value.trim();
       if (message && gameId && currentGameState === 'playing') {
           socket.emit('send_message', { gameId, message });
           chatInput.value = '';
       }
   }
   
   // Sohbet mesajını göster
   function displayChatMessage(message) {
       const messageElement = document.createElement('div');
       messageElement.className = `chat-message ${message.sender}`;
       
       const senderElement = document.createElement('div');
       senderElement.className = 'chat-sender';
       senderElement.textContent = message.sender === 'white' ? 'Beyaz' : 'Siyah';
       
       const textElement = document.createElement('div');
       textElement.className = 'chat-text';
       textElement.textContent = message.text;
       
       messageElement.appendChild(senderElement);
       messageElement.appendChild(textElement);
       
       chatMessages.appendChild(messageElement);
       
       // En alta kaydır
       chatMessages.scrollTop = chatMessages.scrollHeight;
   }
   
   // Satranç tahtasını başlat
   function initializeBoard(orientation = 'white') {
       // Tahta yapılandırması
       const config = {
           draggable: true,
           position: 'start',
           orientation: orientation,
           pieceTheme: '/img/chesspieces/wikipedia/{piece}.svg',
           onDragStart: onDragStart,
           onDrop: onDrop,
           onSnapEnd: onSnapEnd
       };
       
       // Tahtayı oluştur
       board = Chessboard('board', config);
       
       // Duyarlı tasarım için tahta boyutunu ayarla
       window.addEventListener('resize', board.resize);
   }
   
   // Süreyi biçimlendir (mm:ss)
   function formatTime(milliseconds) {
       if (milliseconds < 0) milliseconds = 0;
       
       const totalSeconds = Math.floor(milliseconds / 1000);
       const minutes = Math.floor(totalSeconds / 60);
       const seconds = totalSeconds % 60;
       
       return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
   }
   
   // Saati başlat
   function startClock() {
       if (clockInterval) clearInterval(clockInterval);
       
       const startTime = Date.now();
       let lastTickTime = startTime;
       
       clockInterval = setInterval(() => {
           const now = Date.now();
           const elapsed = now - lastTickTime;
           lastTickTime = now;
           
           // Sadece aktif oyuncunun saatini azalt
           if (currentGameState === 'playing') {
               if (game.turn() === 'w') {
                   clocks.white -= elapsed;
                   whiteTimer.textContent = formatTime(clocks.white);
                   whiteTimer.classList.add('active');
                   blackTimer.classList.remove('active');
                   
                   // Süre aşımı kontrolü
                   if (clocks.white <= 0) {
                       clocks.white = 0;
                       whiteTimer.textContent = formatTime(0);
                       if (playerColor === 'white') {
                           socket.emit('time_out', { gameId });
                       }
                       gameOver('Süre bitti!', 'timeout');
                       clearInterval(clockInterval);
                   }
               } else {
                   clocks.black -= elapsed;
                   blackTimer.textContent = formatTime(clocks.black);
                   blackTimer.classList.add('active');
                   whiteTimer.classList.remove('active');
                   
                   // Süre aşımı kontrolü
                   if (clocks.black <= 0) {
                       clocks.black = 0;
                       blackTimer.textContent = formatTime(0);
                       if (playerColor === 'black') {
                           socket.emit('time_out', { gameId });
                       }
                       gameOver('Süre bitti!', 'timeout');
                       clearInterval(clockInterval);
                   }
               }
           }
       }, 100); // Daha düzgün görüntüleme için 100ms'de bir güncelle
   }
   
   // Bir taş tutulduğunda çağrılan fonksiyon
   function onDragStart(source, piece, position, orientation) {
       // Oyun bittiyse hamleye izin verme
       if (game.game_over()) return false;
       
       // Sadece sırası gelen oyuncunun taşlarını hareket ettirmesine izin ver
       if ((playerColor === 'white' && piece.search(/^b/) !== -1) ||
           (playerColor === 'black' && piece.search(/^w/) !== -1) ||
           currentGameState !== 'playing') {
           return false;
       }
       
       // Sadece şu anki oyuncunun hamlesi için izin ver
       if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
           (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
           return false;
       }
   }
   
   // Bir taş bırakıldığında çağrılan fonksiyon
   function onDrop(source, target) {
       // Hamlenin yasal olup olmadığını kontrol et
       const move = game.move({
           from: source,
           to: target,
           promotion: 'q' // Basitlik için daima vezire terfi et
       });
       
       // Yasal değilse, taşı kaynak kareye geri döndür
       if (move === null) return 'snapback';
       
       // PGN göstergesini güncelle
       updatePGNDisplay();
       
       // Hamleyi sunucuya gönder
       socket.emit('move', {
           gameId: gameId,
           move: { from: source, to: target },
           fen: game.fen(),
           pgn: game.pgn()
       });
       
       // Oyun bitip bitmediğini kontrol et
       if (game.game_over()) {
           let result = '';
           let resultType = '';
           
           if (game.in_checkmate()) {
               result = playerColor === 'white' ? 'Şah mat! Kazandınız!' : 'Şah mat! Kaybettiniz!';
               resultType = 'checkmate';
           } else if (game.in_draw()) {
               result = 'Oyun berabere bitti!';
               resultType = 'draw';
           } else if (game.in_stalemate()) {
               result = 'Pat! Oyun berabere bitti!';
               resultType = 'draw';
           } else if (game.in_threefold_repetition()) {
               result = 'Üç kez tekrar! Oyun berabere bitti!';
               resultType = 'draw';
           } else if (game.insufficient_material()) {
               result = 'Yetersiz materyal! Oyun berabere bitti!';
               resultType = 'draw';
           }
           
           socket.emit('game_over', { gameId, result: resultType });
           gameOver(result, resultType);
       }
   }
   
   // PGN göstergesini güncelle
   function updatePGNDisplay() {
       const pgn = game.pgn();
       // Daha iyi okunabilirlik için PGN'i biçimlendir
       let formattedPgn = '';
       const moves = pgn.split(/\d+\./).filter(move => move.trim() !== '');
       
       moves.forEach((move, index) => {
           formattedPgn += `${index + 1}. ${move.trim()}\n`;
       });
       
       pgnDisplay.textContent = formattedPgn;
       // En alta kaydır
       pgnDisplay.scrollTop = pgnDisplay.scrollHeight;
   }
   
   // Taş animasyonu bittikten sonra tahta pozisyonunu güncelle
   function onSnapEnd() {
       board.position(game.fen());
       highlightLastMove();
   }
   
   // Eşleşme bul
   function findMatch() {
       console.log("Eşleşme aranıyor...");
       
       if (!socket) {
           statusDiv.innerHTML = 'Oynamak için giriş yapmalısınız. <a href="/giris" class="btn primary-btn small-btn">Giriş Yap</a>';
           return;
       }
       
       statusDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rakip bekleniyor...';
       setupContainer.style.display = 'none';
       
       // Socket bağlantı kontrolü
       if (!socket.connected) {
           console.error('Sunucuya bağlanılamadı!');
           statusDiv.innerHTML = 'Sunucuya bağlanılamadı. Sayfayı yenileyin veya daha sonra tekrar deneyin.';
           setupContainer.style.display = 'flex';
           return;
       }
       
       console.log("Socket bağlantı durumu:", socket.connected);
       console.log("Socket kimliği:", socket.id);
       console.log("Süre kontrolü:", timeControl);
       
       // Eşleşme ara
       socket.emit('find_match', timeControl);
       console.log("find_match olayı gönderildi, süre:", timeControl);
       currentGameState = 'waiting';
   }
   
   // Eşleşme bulunduğunda
   function matchFound(data) {
       gameId = data.gameId;
       playerColor = data.color;
       timeControl = data.timeControl || 15;
       opponentName = data.opponent;
       isFriendGame = data.isFriendGame || false;
       
       // Saatleri ayarla
       clocks.white = timeControl * 60 * 1000;
       clocks.black = timeControl * 60 * 1000;
       
       // Saat gösterimlerini güncelle
       whiteTimer.textContent = formatTime(clocks.white);
       blackTimer.textContent = formatTime(clocks.black);
       
       // Oyunu başlat veya sıfırla
       game = new Chess();
       chatMessages.innerHTML = '';
       
       // Arayüzü güncelle
       currentGameState = 'playing';
       gameContainer.style.display = 'block';
       resignBtn.style.display = 'inline-block';
       newGameBtn.style.display = 'none';
       
       let statusText = playerColor === 'white' ? 
           '<i class="fas fa-chess-pawn" style="color: #333;"></i> Beyaz taşlarla oynuyorsunuz' : 
           '<i class="fas fa-chess-pawn" style="color: #000;"></i> Siyah taşlarla oynuyorsunuz';
       
       // Arkadaş oyunu ise belirt
       if (isFriendGame) {
           statusText += ' (Arkadaş Oyunu)';
       }
       
       statusDiv.innerHTML = statusText;
       
       // Rakip adını göster
       opponentNameElement.textContent = opponentName;
       
       // PGN göstergesini temizle
       pgnDisplay.textContent = '';
       
       // Tahtayı doğru yönlendirmeyle başlat
       if (board === null) {
           initializeBoard(playerColor);
       } else {
           board.orientation(playerColor);
           board.position('start');
       }
       
       // Saati başlat
       startClock();
   }
   
   // Rakibin hamlesi
   function opponentMove(data) {
       game.move({
           from: data.move.from,
           to: data.move.to,
           promotion: 'q' // Basitlik için daima vezire terfi et
       });
       
       board.position(game.fen());
       
       // Sağlanmışsa saatleri güncelle
       if (data.whiteTime !== undefined && data.blackTime !== undefined) {
           clocks.white = data.whiteTime;
           clocks.black = data.blackTime;
           whiteTimer.textContent = formatTime(clocks.white);
           blackTimer.textContent = formatTime(clocks.black);
       }
       
       // PGN göstergesini güncelle
       updatePGNDisplay();
       
       // Oyunun bitip bitmediğini kontrol et
       if (game.game_over()) {
           let result = '';
           let resultType = '';
           
           if (game.in_checkmate()) {
               result = playerColor === 'white' ? 'Şah mat! Kaybettiniz!' : 'Şah mat! Kazandınız!';
               resultType = 'checkmate';
           } else if (game.in_draw()) {
               result = 'Oyun berabere bitti!';
               resultType = 'draw';
           } else if (game.in_stalemate()) {
               result = 'Pat! Oyun berabere bitti!';
               resultType = 'draw';
           } else if (game.in_threefold_repetition()) {
               result = 'Üç kez tekrar! Oyun berabere bitti!';
               resultType = 'draw';
           } else if (game.insufficient_material()) {
               result = 'Yetersiz materyal! Oyun berabere bitti!';
               resultType = 'draw';
           }
           
           gameOver(result, resultType);
       }
   }
   
   // Oyun bitti
   function gameOver(result, resultType) {
       currentGameState = 'over';
       statusDiv.innerHTML = `<i class="fas fa-flag-checkered"></i> ${result}`;
       resignBtn.style.display = 'none';
       newGameBtn.style.display = 'inline-block';
       
       // Saati durdur
       if (clockInterval) {
           clearInterval(clockInterval);
       }
       
       // Saatlerden "active" sınıfını kaldır
       whiteTimer.classList.remove('active');
       blackTimer.classList.remove('active');
       
       // Sonuç modalını göster
       resultTitle.textContent = 'Oyun Sonucu';
       resultMessage.textContent = result;
       resultModal.style.display = 'flex';
   }
   
   // Oyundan çekil
   function resignGame() {
       if (currentGameState === 'playing' && gameId) {
           socket.emit('game_over', { gameId, result: 'resignation' });
           gameOver('Teslim oldunuz!', 'resignation');
       }
   }
   
   // Yeni oyun
   function newGame() {
       currentGameState = 'idle';
       gameId = null;
       isFriendGame = false;
       
       // Arayüzü güncelle
       gameContainer.style.display = 'none';
       setupContainer.style.display = 'flex';
       resignBtn.style.display = 'none';
       newGameBtn.style.display = 'none';
       statusDiv.innerHTML = 'Oynamak için süre seçin ve eşleşme bulun';
       resultModal.style.display = 'none';
       
       // Eğer URL'de davet parametresi varsa temizle
       if (window.location.search.includes('invite=')) {
           history.replaceState({}, document.title, window.location.pathname);
       }
       
       // Saati durdur
       if (clockInterval) {
           clearInterval(clockInterval);
       }
   }
   
   // Uygulamayı başlat
   initializeEventListeners();
   loadUserInfo();
});
