document.addEventListener('DOMContentLoaded', () => {
    // Socket.io bağlantısı - sessionId ile kimlik doğrulama
    const socket = io({
        auth: {
            sessionId: getSessionIdFromCookie()
        }
    });
    
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
    
    // DOM elemanları
    const statusDiv = document.getElementById('status');
    const setupContainer = document.getElementById('setup-container');
    const gameContainer = document.getElementById('game-container');
    const timeOptions = document.querySelectorAll('.time-option');
    const startBtn = document.getElementById('start-btn');
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
    
    // Kullanıcı bilgilerini yükle
    loadUserInfo();
    
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
        
        // Modal kapat butonu
        closeModal.addEventListener('click', () => {
            resultModal.style.display = 'none';
        });
        
        // Modal dışına tıklama
        window.addEventListener('click', (e) => {
            if (e.target === resultModal) {
                resultModal.style.display = 'none';
            }
        });
        
        // Çıkış butonu
        logoutBtn.addEventListener('click', logout);
    }
    
    // Kullanıcı bilgilerini yükle
    async function loadUserInfo() {
        try {
            const response = await fetch('/api/kullanici', {
                credentials: 'include', // Çerezleri gönderir
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    console.log('Oturum açılmamış, giriş sayfasına yönlendiriliyor');
                    // Yetkilendirme hatası, giriş sayfasına yönlendir
                    window.location.href = '/giris';
                    return;
                }
                throw new Error(`HTTP hata: ${response.status}`);
            }
            
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                console.error('API JSON döndürmedi:', contentType);
                throw new Error('Geçersiz yanıt türü');
            }
            
            const userData = await response.json();
            
            // Kullanıcı bilgilerini göster
            usernameDisplay.textContent = userData.username;
            eloDisplay.textContent = userData.elo;
            playerName.textContent = userData.username;
            
            // Socket'e kullanıcı kimliğini gönder
            socket.emit('authenticate', userData._id);
            
            // Kullanıcı kimliğini data attribute olarak sakla
            usernameDisplay.setAttribute('data-id', userData._id);
            
        } catch (error) {
            console.error('Kullanıcı bilgisi yükleme hatası:', error);
            // Hata durumunda da giriş sayfasına yönlendir
            window.location.href = '/giris';
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
            pieceTheme: '/img/chesspieces/wikipedia/{piece}.png', // Düzeltilen yol
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
    }
    
    // Eşleşme bul
    function findMatch() {
        // Kullanıcı oturumunu kontrol et
        fetch('/api/kullanici', { credentials: 'include' })
            .then(response => {
                if (!response.ok) {
                    // Oturum yok, giriş sayfasına yönlendir
                    window.location.href = '/giris';
                    return;
                }
                // Oturum varsa eşleşme ara
                socket.emit('find_match', timeControl);
                currentGameState = 'waiting';
                statusDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rakip bekleniyor...';
                setupContainer.style.display = 'none';
            })
            .catch(err => {
                console.error('Oturum kontrolü hatası:', err);
                window.location.href = '/giris';
            });
    }
    
    // Eşleşme bulunduğunda
    function matchFound(data) {
        gameId = data.gameId;
        playerColor = data.color;
        timeControl = data.timeControl || 15;
        opponentName = data.opponent;
        
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
        statusDiv.innerHTML = playerColor === 'white' ? 
            '<i class="fas fa-chess-pawn" style="color: #333;"></i> Beyaz taşlarla oynuyorsunuz' : 
            '<i class="fas fa-chess-pawn" style="color: #000;"></i> Siyah taşlarla oynuyorsunuz';
        
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
        
        // Arayüzü güncelle
        gameContainer.style.display = 'none';
        setupContainer.style.display = 'flex';
        resignBtn.style.display = 'none';
        newGameBtn.style.display = 'none';
        statusDiv.innerHTML = 'Oynamak için süre seçin ve eşleşme bulun';
        resultModal.style.display = 'none';
        
        // Saati durdur
        if (clockInterval) {
            clearInterval(clockInterval);
        }
    }
    
    // Socket bağlantı hatası
    socket.on('connect_error', (error) => {
        console.error('Bağlantı hatası:', error);
        // Oturum sorunu varsa giriş sayfasına yönlendir
        if (error.message === 'authentication_error') {
            window.location.href = '/giris';
        }
    });
    
    // Socket olay dinleyicileri
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
            window.location.href = '/giris';
        } else {
            alert(`Hata: ${data.message}`);
        }
    });
    
    // Uygulamayı başlat
    initializeEventListeners();
});
