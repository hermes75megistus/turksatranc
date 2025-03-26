document.addEventListener('DOMContentLoaded', () => {
    // DOM elemanları
    const usernameDisplay = document.getElementById('username-display');
    const eloDisplay = document.getElementById('elo-display');
    const gamesList = document.getElementById('games-history-list');
    const resultFilter = document.getElementById('result-filter');
    const gameBoard = document.getElementById('game-board');
    const gameBoardContainer = document.getElementById('game-board-container');
    const selectedGameDetails = document.getElementById('selected-game-details');
    const noGameSelected = document.querySelector('.no-game-selected');
    const whitePlayerName = document.getElementById('white-player-name');
    const blackPlayerName = document.getElementById('black-player-name');
    const gameResultText = document.getElementById('game-result-text');
    const gameTime = document.getElementById('game-time');
    const gameDate = document.getElementById('game-date');
    const gameMovesCount = document.getElementById('game-moves-count');
    const pgnDisplay = document.getElementById('pgn-display');
    const firstMoveBtn = document.getElementById('first-move');
    const prevMoveBtn = document.getElementById('prev-move');
    const playPauseBtn = document.getElementById('play-pause');
    const nextMoveBtn = document.getElementById('next-move');
    const lastMoveBtn = document.getElementById('last-move');
    const replaySpeed = document.getElementById('replay-speed');
    const downloadPgnBtn = document.getElementById('download-pgn');
    const shareGameBtn = document.getElementById('share-game');
    const shareModal = document.getElementById('share-modal');
    const shareLink = document.getElementById('share-link');
    const copyBtn = document.getElementById('copy-btn');
    const shareFacebook = document.getElementById('share-facebook');
    const shareTwitter = document.getElementById('share-twitter');
    const shareWhatsapp = document.getElementById('share-whatsapp');
    const closeModal = document.querySelector('.close-modal');
    const logoutBtn = document.getElementById('logout-btn');
    
    // Durum değişkenleri
    let games = [];
    let selectedGame = null;
    let board = null;
    let chess = null;
    let moves = [];
    let currentMoveIndex = 0;
    let isPlaying = false;
    let playbackInterval = null;
    
    // Event listener'ları başlat
    function initEventListeners() {
        // Sonuç filtresi
        resultFilter.addEventListener('change', filterGames);
        
        // Oyun kontrolleri
        firstMoveBtn.addEventListener('click', goToFirstMove);
        prevMoveBtn.addEventListener('click', goToPrevMove);
        playPauseBtn.addEventListener('click', togglePlayback);
        nextMoveBtn.addEventListener('click', goToNextMove);
        lastMoveBtn.addEventListener('click', goToLastMove);
        
        // Paylaşım işlemleri
        shareGameBtn.addEventListener('click', showShareModal);
        copyBtn.addEventListener('click', copyShareLink);
        
        // Sosyal medya paylaşımları
        shareFacebook.addEventListener('click', () => shareOnSocialMedia('facebook'));
        shareTwitter.addEventListener('click', () => shareOnSocialMedia('twitter'));
        shareWhatsapp.addEventListener('click', () => shareOnSocialMedia('whatsapp'));
        
        // PGN indirme
        downloadPgnBtn.addEventListener('click', downloadPgn);
        
        // Modal kapatma
        closeModal.addEventListener('click', () => {
            shareModal.style.display = 'none';
        });
        
        // Modal dışına tıklandığında kapat
        window.addEventListener('click', (e) => {
            if (e.target === shareModal) {
                shareModal.style.display = 'none';
            }
        });
        
        // Çıkış butonu
        logoutBtn.addEventListener('click', logout);
    }
    
    // Kullanıcı bilgilerini yükle
    async function loadUserInfo() {
        try {
            const response = await fetch('/api/kullanici', {
                credentials: 'include' // Çerezleri gönder
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    // Yetkilendirme hatası, giriş sayfasına yönlendir
                    window.location.href = '/giris';
                    return;
                }
                throw new Error('Kullanıcı bilgisi alınamadı');
            }
            
            const userData = await response.json();
            
            // Kullanıcı bilgilerini göster
            usernameDisplay.textContent = userData.username;
            eloDisplay.textContent = userData.elo;
            
            // Kullanıcı kimliğini data attribute olarak sakla
            usernameDisplay.setAttribute('data-id', userData._id);
            
        } catch (error) {
            console.error('Kullanıcı bilgisi yükleme hatası:', error);
            window.location.href = '/giris';
        }
    }
    
    // Geçmiş oyunları yükle
    async function loadGames() {
        try {
            // Yükleniyor göstergesini göster
            gamesList.innerHTML = `
                <div class="loading-indicator">
                    <i class="fas fa-spinner fa-spin"></i> Oyunlar yükleniyor...
                </div>
            `;
            
            const response = await fetch('/api/gecmis-oyunlar', {
                credentials: 'include' // Çerezleri gönder
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    window.location.href = '/giris';
                    return;
                }
                throw new Error('Oyun geçmişi alınamadı');
            }
            
            games = await response.json();
            
            // Oyunlar yüklendikten sonra URL'deki oyun kimliğini kontrol et
            checkUrlForGameId();
            
            // Oyunları listele
            displayGames(games);
            
        } catch (error) {
            console.error('Oyun geçmişi yükleme hatası:', error);
            gamesList.innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-circle"></i> Oyunlar yüklenirken bir hata oluştu. Lütfen daha sonra tekrar deneyin.
                </div>
            `;
        }
    }
    
    // URL'deki oyun kimliğini kontrol et
    function checkUrlForGameId() {
        const urlParams = new URLSearchParams(window.location.search);
        const gameId = urlParams.get('id');
        
        if (gameId) {
            // URL'de oyun kimliği varsa, o oyunu seç
            const game = games.find(g => g._id === gameId);
            if (game) {
                selectGame(game);
                
                // İlgili oyunu listede de seç
                setTimeout(() => {
                    const gameElement = document.querySelector(`.game-history-item[data-id="${gameId}"]`);
                    if (gameElement) {
                        gameElement.classList.add('active');
                        gameElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 100);
            }
        }
    }
    
    // Oyunları görüntüle
    function displayGames(gamesData) {
        // Oyunlar listesini temizle
        gamesList.innerHTML = '';
        
        if (gamesData.length === 0) {
            gamesList.innerHTML = `
                <div class="no-games">
                    <i class="fas fa-chess"></i>
                    <p>Henüz oynanmış oyun bulunmuyor.</p>
                </div>
            `;
            return;
        }
        
        // Kullanıcı kimliğini al
        const userId = usernameDisplay.getAttribute('data-id');
        
        // Her oyun için bir öğe oluştur
        gamesData.forEach(game => {
            // WhitePlayer ve blackPlayer null değilse devam et
            if (!game.whitePlayer || !game.blackPlayer) {
                console.error('Eksik oyuncu bilgisi:', game);
                return;
            }
            
            const isWhite = game.whitePlayer._id === userId;
            const opponent = isWhite ? game.blackPlayer.username : game.whitePlayer.username;
            
            // Sonucu belirle
            let resultText = '';
            let resultClass = '';
            
            if (game.result === 'white') {
                resultText = isWhite ? 'Galibiyet' : 'Mağlubiyet';
                resultClass = isWhite ? 'win' : 'loss';
            } else if (game.result === 'black') {
                resultText = isWhite ? 'Mağlubiyet' : 'Galibiyet';
                resultClass = isWhite ? 'loss' : 'win';
            } else if (game.result === 'draw') {
                resultText = 'Beraberlik';
                resultClass = 'draw';
            }
            
            // Tarihi biçimlendir
            const gameEndDate = new Date(game.endTime);
            const formattedDate = gameEndDate.toLocaleDateString('tr-TR');
            
            // Oyun öğesini oluştur
            const gameItem = document.createElement('div');
            gameItem.className = `game-history-item`;
            gameItem.dataset.id = game._id;
            
            gameItem.innerHTML = `
                <div class="game-history-header">
                    <span class="game-opponent-name">${opponent}</span>
                    <span class="game-history-date">${formattedDate}</span>
                </div>
                <div class="game-history-result">
                    <span class="result-indicator result-${resultClass}"></span>
                    <span>${resultText}</span>
                    <span class="game-time-control">${game.timeControl} dk</span>
                </div>
            `;
            
            // Oyun seçme olayını ekle
            gameItem.addEventListener('click', () => {
                // Tüm oyunlardan "active" sınıfını kaldır
                document.querySelectorAll('.game-history-item').forEach(item => {
                    item.classList.remove('active');
                });
                
                // Bu oyuna "active" sınıfını ekle
                gameItem.classList.add('active');
                
                // Oyunu seç
                selectGame(game);
                
                // URL'yi güncelle (tarayıcı geçmişini etkilemeden)
                window.history.replaceState({}, '', `/gecmis-oyunlar?id=${game._id}`);
            });
            
            gamesList.appendChild(gameItem);
        });
    }
    
    // Oyunları filtrele
    function filterGames() {
        const filterValue = resultFilter.value;
        const userId = usernameDisplay.getAttribute('data-id');
        
        let filteredGames = [...games];
        
        if (filterValue !== 'all') {
            filteredGames = games.filter(game => {
                // WhitePlayer ve blackPlayer kontrolü
                if (!game.whitePlayer || !game.blackPlayer) return false;
                
                const isWhite = game.whitePlayer._id === userId;
                
                if (filterValue === 'win') {
                    return (game.result === 'white' && isWhite) || (game.result === 'black' && !isWhite);
                } else if (filterValue === 'loss') {
                    return (game.result === 'black' && isWhite) || (game.result === 'white' && !isWhite);
                } else if (filterValue === 'draw') {
                    return game.result === 'draw';
                }
                
                return true;
            });
        }
        
        displayGames(filteredGames);
    }
    
    // Oyun seç
    function selectGame(game) {
        selectedGame = game;
        
        // Oyun detaylarını göster
        noGameSelected.style.display = 'none';
        selectedGameDetails.style.display = 'block';
        
        // Oyuncu adlarını güncelle
        if (game.whitePlayer && game.blackPlayer) {
            whitePlayerName.textContent = game.whitePlayer.username;
            blackPlayerName.textContent = game.blackPlayer.username;
        }
        
        // Sonucu görüntüle
        let resultText = '';
        if (game.result === 'white') {
            resultText = '1 - 0';
        } else if (game.result === 'black') {
            resultText = '0 - 1';
        } else {
            resultText = '½ - ½';
        }
        gameResultText.textContent = resultText;
        
        // Oyun bilgilerini güncelle
        gameTime.textContent = `${game.timeControl} dk`;
        
        const endDate = new Date(game.endTime);
        gameDate.textContent = endDate.toLocaleDateString('tr-TR');
        
        const movesCount = game.moves ? game.moves.length : 0;
        gameMovesCount.textContent = `${movesCount} hamle`;
        
        // Satranç motorunu ve tahtayı başlat
        setupChessEngine(game);
    }
    
    // Satranç motorunu ayarla
    function setupChessEngine(game) {
        // Satranç motorunu oluştur
        chess = new Chess();
        
        // Tahta zaten oluşturulmuşsa temizle
        if (board) {
            board.clear();
            board = null;
        }
        
        // Tahtayı oluştur
        board = Chessboard('game-board', {
            position: 'start',
            pieceTheme: '/img/chesspieces/wikipedia/{piece}.png' // Düzeltilen yol
        });
        
        // Hamleleri ayarla
        if (game.pgn) {
            try {
                // PGN'yi yükle
                chess.load_pgn(game.pgn);
                
                // PGN'yi göster
                pgnDisplay.textContent = formatPgn(game.pgn);
                
                // Hamleleri çıkar
                moves = [];
                const history = chess.history({ verbose: true });
                
                // Başlangıç pozisyonu ekle
                moves.push({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' });
                
                // Her hamleden sonraki pozisyonu ekle
                let currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
                history.forEach(move => {
                    const tempChess = new Chess(currentFen);
                    tempChess.move(move);
                    currentFen = tempChess.fen();
moves.push({ 
                        fen: currentFen,
                        from: move.from,
                        to: move.to,
                        san: move.san
                    });
                });
                
                // Son pozisyonu göster
                chess.reset();
                chess.load_pgn(game.pgn);
                board.position(chess.fen());
                
                // Mevcut hamle indeksini ayarla
                currentMoveIndex = moves.length - 1;
                
                // Kontrol butonlarını etkinleştir
                updateControlButtons();
            } catch (e) {
                console.error('PGN yükleme hatası:', e);
                pgnDisplay.textContent = 'PGN yüklenirken bir hata oluştu. Geçersiz format.';
            }
        } else {
            pgnDisplay.textContent = 'Bu oyun için PGN verisi bulunmuyor.';
        }
    }
    
    // PGN'yi biçimlendir
    function formatPgn(pgn) {
        try {
            // Her hamleyi yeni satırda göster
            return pgn.replace(/(\d+\.)/g, '\n$1').trim();
        } catch (e) {
            console.error('PGN biçimlendirme hatası:', e);
            return pgn || '';
        }
    }
    
    // İlk hamleye git
    function goToFirstMove() {
        stopPlayback();
        currentMoveIndex = 0;
        board.position(moves[currentMoveIndex].fen);
        updateControlButtons();
    }
    
    // Önceki hamleye git
    function goToPrevMove() {
        stopPlayback();
        if (currentMoveIndex > 0) {
            currentMoveIndex--;
            board.position(moves[currentMoveIndex].fen);
            updateControlButtons();
        }
    }
    
    // Oynatmayı başlat/durdur
    function togglePlayback() {
        if (isPlaying) {
            stopPlayback();
        } else {
            startPlayback();
        }
    }
    
    // Oynatmayı başlat
    function startPlayback() {
        if (!moves || moves.length <= 1) return;
        
        if (currentMoveIndex >= moves.length - 1) {
            // Son hamledeysek başa dön
            currentMoveIndex = 0;
            board.position(moves[currentMoveIndex].fen);
        }
        
        isPlaying = true;
        playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
        
        // Oynatma hızını al
        const speed = parseInt(replaySpeed.value) || 500;
        
        // Hamleler arasında belirli bir süre bekleyerek otomatik oynat
        playbackInterval = setInterval(() => {
            if (currentMoveIndex < moves.length - 1) {
                currentMoveIndex++;
                board.position(moves[currentMoveIndex].fen);
                updateControlButtons();
            } else {
                // Son hamleye gelince durdur
                stopPlayback();
            }
        }, speed);
    }
    
    // Oynatmayı durdur
    function stopPlayback() {
        isPlaying = false;
        playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        
        if (playbackInterval) {
            clearInterval(playbackInterval);
            playbackInterval = null;
        }
    }
    
    // Sonraki hamleye git
    function goToNextMove() {
        stopPlayback();
        if (moves && currentMoveIndex < moves.length - 1) {
            currentMoveIndex++;
            board.position(moves[currentMoveIndex].fen);
            updateControlButtons();
        }
    }
    
    // Son hamleye git
    function goToLastMove() {
        stopPlayback();
        if (moves && moves.length > 0) {
            currentMoveIndex = moves.length - 1;
            board.position(moves[currentMoveIndex].fen);
            updateControlButtons();
        }
    }
    
    // Kontrol butonlarını güncelle
    function updateControlButtons() {
        if (!moves || moves.length <= 1) {
            // Hamle yoksa tüm butonları devre dışı bırak
            firstMoveBtn.disabled = true;
            prevMoveBtn.disabled = true;
            playPauseBtn.disabled = true;
            nextMoveBtn.disabled = true;
            lastMoveBtn.disabled = true;
            return;
        }
        
        firstMoveBtn.disabled = currentMoveIndex === 0;
        prevMoveBtn.disabled = currentMoveIndex === 0;
        nextMoveBtn.disabled = currentMoveIndex === moves.length - 1;
        lastMoveBtn.disabled = currentMoveIndex === moves.length - 1;
        playPauseBtn.disabled = false;
    }
    
    // Paylaşım modalını göster
    function showShareModal() {
        if (!selectedGame) return;
        
        // Paylaşım linkini oluştur
        const shareUrl = `${window.location.origin}/gecmis-oyunlar?id=${selectedGame._id}`;
        shareLink.value = shareUrl;
        
        // Sosyal medya linklerini güncelle
        shareFacebook.href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
        shareTwitter.href = `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent('TürkSatranç\'ta oynadığım bir oyunu incelemek ister misiniz?')}`;
        shareWhatsapp.href = `https://wa.me/?text=${encodeURIComponent('TürkSatranç\'ta oynadığım bir oyunu incelemek ister misiniz? ' + shareUrl)}`;
        
        // Modalı göster
        shareModal.style.display = 'flex';
    }
    
    // Paylaşım linkini kopyala
    function copyShareLink() {
        shareLink.select();
        document.execCommand('copy');
        
        // Kopyalama başarılı göstergesi
        copyBtn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => {
            copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
        }, 2000);
    }
    
    // Sosyal medyada paylaş
    function shareOnSocialMedia(platform) {
        if (!selectedGame) return;
        
        const shareUrl = `${window.location.origin}/gecmis-oyunlar?id=${selectedGame._id}`;
        
        switch (platform) {
            case 'facebook':
                window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, '_blank');
                break;
            case 'twitter':
                window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent('TürkSatranç\'ta oynadığım bir oyunu incelemek ister misiniz?')}`, '_blank');
                break;
            case 'whatsapp':
                window.open(`https://wa.me/?text=${encodeURIComponent('TürkSatranç\'ta oynadığım bir oyunu incelemek ister misiniz? ' + shareUrl)}`, '_blank');
                break;
        }
    }
    
    // PGN dosyasını indir
    function downloadPgn() {
        if (!selectedGame || !selectedGame.pgn) return;
        
        // PGN içeriği oluştur
        const pgn = selectedGame.pgn;
        
        // İndirme dosyası oluştur
        const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
        const url = URL.createObjectURL(blob);
        
        try {
            // Dosya adı oluştur
            const whitePlayer = selectedGame.whitePlayer ? selectedGame.whitePlayer.username : 'BeyazOyuncu';
            const blackPlayer = selectedGame.blackPlayer ? selectedGame.blackPlayer.username : 'SiyahOyuncu';
            const date = new Date(selectedGame.endTime).toISOString().split('T')[0];
            
            const fileName = `${whitePlayer}_vs_${blackPlayer}_${date}.pgn`;
            
            // İndirme linki oluştur ve tıkla
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (e) {
            console.error('PGN indirme hatası:', e);
            alert('PGN dosyası indirilirken bir hata oluştu.');
        } finally {
            // Obje URL'yi serbest bırak
            URL.revokeObjectURL(url);
        }
    }
    
    // Çıkış işlemi
    async function logout() {
        try {
            const response = await fetch('/api/cikis', {
                credentials: 'include'
            });
            
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
    
    // Uygulamayı başlat
    initEventListeners();
    loadUserInfo().then(() => {
        loadGames();
    });
});