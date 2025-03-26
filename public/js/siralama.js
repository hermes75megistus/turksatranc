document.addEventListener('DOMContentLoaded', () => {
    // DOM elemanları
    const usernameDisplay = document.getElementById('username-display');
    const eloDisplay = document.getElementById('elo-display');
    const rankingBody = document.getElementById('ranking-body');
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const pageInfo = document.getElementById('page-info');
    const logoutBtn = document.getElementById('logout-btn');
    
    // Durum değişkenleri
    let currentPage = 1;
    let totalPages = 1;
    let pageSize = 20;
    let searchTerm = '';
    
    // Event listener'ları başlat
    function initEventListeners() {
        // Arama butonu
        searchBtn.addEventListener('click', () => {
            searchTerm = searchInput.value.trim();
            currentPage = 1;
            loadRankings();
        });
        
        // Enter tuşuna basınca ara
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchTerm = searchInput.value.trim();
                currentPage = 1;
                loadRankings();
            }
        });
        
        // Sayfa gezinme butonları
        prevPageBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                loadRankings();
            }
        });
        
        nextPageBtn.addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                loadRankings();
            }
        });
        
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
            
        } catch (error) {
            console.error('Kullanıcı bilgisi yükleme hatası:', error);
        }
    }
    
    // Sıralama verilerini yükle
    async function loadRankings() {
        // URL oluştur
        let url = `/api/siralama?page=${currentPage}&limit=${pageSize}`;
        if (searchTerm) {
            url += `&search=${encodeURIComponent(searchTerm)}`;
        }
        
        try {
            // Yükleniyor göstergesini göster
            rankingBody.innerHTML = `
                <tr class="loading-row">
                    <td colspan="8">
                        <div class="loading-indicator">
                            <i class="fas fa-spinner fa-spin"></i> Sıralama verileri yükleniyor...
                        </div>
                    </td>
                </tr>
            `;
            
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error('Sıralama verileri alınamadı');
            }
            
            const data = await response.json();
            const { users, pagination } = data;
            
            // Sayfalama bilgilerini güncelle
            totalPages = pagination.totalPages || 1;
            currentPage = pagination.currentPage || 1;
            pageInfo.textContent = `Sayfa ${currentPage} / ${totalPages}`;
            
            // Gezinme butonlarını güncelle
            prevPageBtn.disabled = currentPage <= 1;
            nextPageBtn.disabled = currentPage >= totalPages;
            
            // Tabloyu temizle
            rankingBody.innerHTML = '';
            
            // Kullanıcı yoksa mesaj göster
            if (users.length === 0) {
                rankingBody.innerHTML = `
                    <tr>
                        <td colspan="8" class="no-data">
                            ${searchTerm ? 'Arama kriterlerine uygun kullanıcı bulunamadı.' : 'Henüz hiç kullanıcı bulunmuyor.'}
                        </td>
                    </tr>
                `;
                return;
            }
            
            // Her kullanıcı için bir satır oluştur
            users.forEach((user, index) => {
                const rank = (currentPage - 1) * pageSize + index + 1;
                
                // Kazanma oranını hesapla
                const totalGames = user.gamesPlayed;
                const winRate = totalGames > 0 ? Math.round((user.wins / totalGames) * 100) : 0;
                
                // Satırı oluştur
                const row = document.createElement('tr');
                
                // Mevcut kullanıcıyı vurgula
                if (user.username === usernameDisplay.textContent) {
                    row.classList.add('current-user');
                }
                
                row.innerHTML = `
                    <td>${rank}</td>
                    <td>${user.username}</td>
                    <td>${user.elo}</td>
                    <td>${user.gamesPlayed}</td>
                    <td>${user.wins}</td>
                    <td>${user.draws}</td>
                    <td>${user.losses}</td>
                    <td>${winRate}%</td>
                `;
                
                rankingBody.appendChild(row);
            });
            
        } catch (error) {
            console.error('Sıralama verileri yükleme hatası:', error);
            rankingBody.innerHTML = `
                <tr>
                    <td colspan="8" class="error-data">
                        Sıralama verileri yüklenirken bir hata oluştu. Lütfen daha sonra tekrar deneyin.
                    </td>
                </tr>
            `;
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
    loadRankings();
});