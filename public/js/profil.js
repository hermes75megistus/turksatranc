document.addEventListener('DOMContentLoaded', () => {
    // DOM elemanları
    const usernameDisplay = document.getElementById('username-display');
    const eloDisplay = document.getElementById('elo-display');
    const profileUsername = document.getElementById('profile-username');
    const profileElo = document.getElementById('profile-elo');
    const gamesPlayed = document.getElementById('games-played');
    const wins = document.getElementById('wins');
    const draws = document.getElementById('draws');
    const losses = document.getElementById('losses');
    const winSegment = document.getElementById('win-segment');
    const drawSegment = document.getElementById('draw-segment');
    const loseSegment = document.getElementById('lose-segment');
    const winPercentage = document.getElementById('win-percentage');
    const drawPercentage = document.getElementById('draw-percentage');
    const losePercentage = document.getElementById('lose-percentage');
    const profileEmail = document.getElementById('profile-email');
    const profileRegistered = document.getElementById('profile-registered');
    const recentGames = document.getElementById('recent-games');
    const editProfileBtn = document.getElementById('edit-profile-btn');
    const changePasswordBtn = document.getElementById('change-password-btn');
    const passwordModal = document.getElementById('password-modal');
    const passwordForm = document.getElementById('password-form');
    const passwordError = document.getElementById('password-error');
    const logoutBtn = document.getElementById('logout-btn');
    const closeModal = document.querySelector('.close-modal');

    // Event listener'ları başlat
    function initEventListeners() {
        // Şifre değiştirme butonuna tıklandığında
        changePasswordBtn.addEventListener('click', () => {
            passwordModal.style.display = 'flex';
        });

        // Modal kapatma
        closeModal.addEventListener('click', () => {
            passwordModal.style.display = 'none';
        });

        // Modal dışına tıklandığında kapat
        window.addEventListener('click', (e) => {
            if (e.target === passwordModal) {
                passwordModal.style.display = 'none';
            }
        });

        // Şifre değiştirme formunu gönderme
        passwordForm.addEventListener('submit', changePassword);
	// Çıkış butonu
        logoutBtn.addEventListener('click', logout);
    }

    // Kullanıcı bilgilerini yükle
    async function loadUserInfo() {
        try {
            const response = await fetch('/api/kullanici');
            
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
            profileUsername.textContent = userData.username;
            profileElo.textContent = userData.elo;
            profileEmail.textContent = userData.email;
            
            // Tarih biçimlendirme
            const registeredDate = new Date(userData.registeredAt);
            profileRegistered.textContent = registeredDate.toLocaleDateString('tr-TR');
            
            // İstatistikleri güncelle
            gamesPlayed.textContent = userData.gamesPlayed;
            wins.textContent = userData.wins;
            draws.textContent = userData.draws;
            losses.textContent = userData.losses;
            
            // Kazanma oranı çubuğunu hesapla
            const total = userData.gamesPlayed;
            if (total > 0) {
                const winRate = (userData.wins / total) * 100;
                const drawRate = (userData.draws / total) * 100;
                const lossRate = (userData.losses / total) * 100;
                
                winSegment.style.width = `${winRate}%`;
                drawSegment.style.width = `${drawRate}%`;
                loseSegment.style.width = `${lossRate}%`;
                
                winPercentage.textContent = `${Math.round(winRate)}%`;
                drawPercentage.textContent = `${Math.round(drawRate)}%`;
                losePercentage.textContent = `${Math.round(lossRate)}%`;
            }
            
            // Son oyunları yükle
            loadRecentGames();
            
        } catch (error) {
            console.error('Kullanıcı bilgisi yükleme hatası:', error);
        }
    }
    
    // Son oyunları yükle
    async function loadRecentGames() {
        try {
            const response = await fetch('/api/gecmis-oyunlar?limit=5');
            
            if (!response.ok) {
                throw new Error('Oyun geçmişi alınamadı');
            }
            
            const games = await response.json();
            
            // Yükleniyor göstergesini kaldır
            recentGames.innerHTML = '';
            
            if (games.length === 0) {
                recentGames.innerHTML = '<p class="no-games">Henüz oynanmış oyun bulunmuyor.</p>';
                return;
            }
            
            // Her oyun için bir kart oluştur
            games.forEach(game => {
                const userId = usernameDisplay.getAttribute('data-id');
                const isWhite = game.whitePlayer._id === userId;
                const opponent = isWhite ? game.blackPlayer.username : game.whitePlayer.username;
                
                // Sonucu belirle
                let result = '';
                let resultClass = '';
                
                if (game.result === 'white') {
                    result = isWhite ? 'G' : 'M';
                    resultClass = isWhite ? 'win' : 'loss';
                } else if (game.result === 'black') {
                    result = isWhite ? 'M' : 'G';
                    resultClass = isWhite ? 'loss' : 'win';
                } else {
                    result = 'B';
                    resultClass = 'draw';
                }
                
                // Tarih biçimlendirme
                const gameDate = new Date(game.endTime);
                const formattedDate = gameDate.toLocaleDateString('tr-TR');
                
                // Oyun kartını oluştur
                const gameHTML = `
                    <div class="game-item" data-id="${game._id}">
                        <div class="game-result ${resultClass}">${result}</div>
                        <div class="game-players">
                            <span class="game-opponent">${opponent}</span>
                        </div>
                        <div class="game-info">
                            <div class="game-date">${formattedDate}</div>
                            <div class="game-time-control">${game.timeControl} dk</div>
                        </div>
                    </div>
                `;
                
                recentGames.innerHTML += gameHTML;
            });
            
            // Oyunlara tıklanabilirlik ekle
            document.querySelectorAll('.game-item').forEach(item => {
                item.addEventListener('click', () => {
                    window.location.href = `/gecmis-oyunlar?id=${item.dataset.id}`;
                });
            });
            
        } catch (error) {
            console.error('Oyun geçmişi yükleme hatası:', error);
            recentGames.innerHTML = '<p class="error">Oyun geçmişi yüklenirken bir hata oluştu.</p>';
        }
    }
    
    // Şifre değiştirme
    async function changePassword(e) {
        e.preventDefault();
        
        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        
        // Yeni şifrelerin eşleşip eşleşmediğini kontrol et
        if (newPassword !== confirmPassword) {
            passwordError.textContent = 'Yeni şifreler eşleşmiyor!';
            passwordError.style.display = 'block';
            return;
        }
        
        try {
            const response = await fetch('/api/sifre-degistir', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    currentPassword,
                    newPassword
                })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                passwordError.textContent = data.error || 'Şifre değiştirme işlemi başarısız oldu.';
                passwordError.style.display = 'block';
                return;
            }
            
            // Başarılı olursa modalı kapat ve formu sıfırla
            passwordModal.style.display = 'none';
            passwordForm.reset();
            passwordError.style.display = 'none';
            
            // Başarı mesajı göster
            alert('Şifreniz başarıyla değiştirildi!');
            
        } catch (error) {
            console.error('Şifre değiştirme hatası:', error);
            passwordError.textContent = 'Bir hata oluştu. Lütfen tekrar deneyin.';
            passwordError.style.display = 'block';
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
    
    // Uygulamayı başlat
    initEventListeners();
    loadUserInfo();
});