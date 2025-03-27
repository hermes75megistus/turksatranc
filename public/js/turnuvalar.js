document.addEventListener('DOMContentLoaded', () => {
    // DOM Elemanları
    const usernameDisplay = document.getElementById('username-display');
    const eloDisplay = document.getElementById('elo-display');
    const createTournamentBtn = document.getElementById('create-tournament-btn');
    const statusFilter = document.getElementById('status-filter');
    const myTournamentsCheckbox = document.getElementById('my-tournaments');
    const tournamentsContainer = document.getElementById('tournaments-container');
    const createTournamentModal = document.getElementById('create-tournament-modal');
    const closeModal = document.querySelector('.close-modal');
    const tournamentForm = document.getElementById('tournament-form');
    const tournamentError = document.getElementById('tournament-error');
    const logoutBtn = document.getElementById('logout-btn');
    
    // Durum değişkenleri
    let userId = null;
    let allTournaments = [];
    
    // Kullanıcı bilgilerini yükle
    async function loadUserInfo() {
        try {
            const response = await fetch('/api/kullanici', {
                credentials: 'include'
            });
            
            if (!response.ok) {
                window.location.href = '/giris';
                return;
            }
            
            const userData = await response.json();
            userId = userData._id;
            
            // Kullanıcı bilgilerini göster
            usernameDisplay.textContent = userData.username;
            eloDisplay.textContent = userData.elo;
            usernameDisplay.setAttribute('data-id', userData._id);
            
            // Turnuvaları yükle
            loadTournaments();
        } catch (error) {
            console.error('Kullanıcı bilgisi yükleme hatası:', error);
            alert('Kullanıcı bilgisi alınamadı.');
        }
    }
    
    // Turnuvaları yükle
    async function loadTournaments() {
        try {
            // Yükleniyor göstergesini göster
            tournamentsContainer.innerHTML = `
                <div class="loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Turnuvalar yükleniyor...</p>
                </div>
            `;
            
            const response = await fetch('/api/turnuvalar', {
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error('Turnuvalar alınamadı');
            }
            
            allTournaments = await response.json();
            
            // Turnuvaları filtrele ve göster
            filterTournaments();
            
        } catch (error) {
            console.error('Turnuva yükleme hatası:', error);
            tournamentsContainer.innerHTML = `
                <div class="no-tournaments">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>Turnuvalar yüklenirken bir hata oluştu.</p>
                </div>
            `;
        }
    }
    
    // Turnuvaları filtrele
    function filterTournaments() {
        const statusValue = statusFilter.value;
        const showOnlyMyTournaments = myTournamentsCheckbox.checked;
        
        let filteredTournaments = [...allTournaments];
        
        // Durum filtresini uygula
        if (statusValue !== 'all') {
            filteredTournaments = filteredTournaments.filter(t => t.status === statusValue);
        }
        
        // Sadece katıldığım turnuvalar filtresini uygula
        if (showOnlyMyTournaments) {
            filteredTournaments = filteredTournaments.filter(t => 
                t.participants.some(p => p === userId) || t.creator === userId
            );
        }
        
        // Filtrelenmiş turnuvaları göster
        displayTournaments(filteredTournaments);
    }
    
    // Turnuvaları görüntüle
    function displayTournaments(tournaments) {
        if (tournaments.length === 0) {
            tournamentsContainer.innerHTML = `
                <div class="no-tournaments">
                    <i class="fas fa-medal"></i>
                    <p>Görüntülenecek turnuva bulunamadı.</p>
                </div>
            `;
            return;
        }
        
        let html = '';
        
        tournaments.forEach(tournament => {
            // Tarihi formatlama
            const startDate = new Date(tournament.startTime);
            const formattedDate = startDate.toLocaleString('tr-TR');
            
            // Kullanıcının bu turnuvaya katılıp katılmadığını kontrol et
            const isParticipant = tournament.participants.some(p => p === userId);
            const isCreator = tournament.creator === userId;
            
            html += `
                <div class="tournament-card">
                    <div class="tournament-header">
                        <div class="tournament-name">${tournament.name}</div>
                        <div class="tournament-status status-${tournament.status}">${getStatusText(tournament.status)}</div>
                    </div>
                    <div class="tournament-info">
                        <div class="tournament-meta">
                            <div class="meta-row">
                                <div class="meta-label">Başlangıç:</div>
                                <div class="meta-value">${formattedDate}</div>
                            </div>
                            <div class="meta-row">
                                <div class="meta-label">Süre:</div>
                                <div class="meta-value">${tournament.timeControl} dakika</div>
                            </div>
                            <div class="meta-row">
                                <div class="meta-label">Organizatör:</div>
                                <div class="meta-value">${tournament.creator.username || 'Bilinmiyor'}</div>
                            </div>
                        </div>
                        <div class="tournament-participants">
                            <div class="participant-count">
                                <i class="fas fa-users"></i> ${tournament.participants.length}/${tournament.maxParticipants}
                            </div>
                            <div class="tournament-rounds">
                                <i class="fas fa-layer-group"></i> ${tournament.rounds} Tur
                            </div>
                        </div>
                    </div>
                    <div class="tournament-actions">
                        <a href="/turnuva/${tournament._id}" class="btn primary-btn">
                            <i class="fas fa-eye"></i> Detaylar
                        </a>
                        ${getActionButton(tournament, isParticipant, isCreator)}
                    </div>
                </div>
            `;
        });
        
        tournamentsContainer.innerHTML = html;
        
        // Katıl/Ayrıl butonları için event listener'ları ekle
        addActionButtonListeners();
    }
    
    // Durum metnini al
    function getStatusText(status) {
        switch (status) {
            case 'created': return 'Oluşturuldu';
            case 'registration': return 'Kayıt Açık';
            case 'inProgress': return 'Devam Ediyor';
            case 'completed': return 'Tamamlandı';
            case 'cancelled': return 'İptal Edildi';
            default: return status;
        }
    }
    
    // Aksiyon butonunu al
    function getActionButton(tournament, isParticipant, isCreator) {
        if (tournament.status === 'registration') {
            if (isParticipant) {
                return `<button class="btn secondary-btn leave-btn" data-id="${tournament._id}">
                    <i class="fas fa-sign-out-alt"></i> Ayrıl
                </button>`;
            } else if (!isCreator && tournament.participants.length < tournament.maxParticipants) {
                return `<button class="btn secondary-btn join-btn" data-id="${tournament._id}">
                    <i class="fas fa-sign-in-alt"></i> Katıl
                </button>`;
            }
        }
        
        if (isCreator && tournament.status === 'registration') {
            return `<button class="btn secondary-btn start-btn" data-id="${tournament._id}">
                <i class="fas fa-play"></i> Başlat
            </button>`;
        }
        
        return '';
    }
    
    // Aksiyon butonları için event listener'lar
    function addActionButtonListeners() {
        // Katıl butonları
        document.querySelectorAll('.join-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.closest('.join-btn').dataset.id;
                try {
                    const response = await fetch(`/api/turnuvalar/${id}/katil`, {
                        method: 'POST',
                        credentials: 'include'
                    });
                    
                    const data = await response.json();
                    
                    if (!response.ok) {
                        alert(data.error || 'Turnuvaya katılırken bir hata oluştu.');
                        return;
                    }
                    
                    alert('Turnuvaya başarıyla katıldınız!');
                    loadTournaments(); // Turnuvaları yenile
                } catch (error) {
                    console.error('Turnuvaya katılma hatası:', error);
                    alert('Turnuvaya katılırken bir hata oluştu.');
                }
            });
        });
        
        // Ayrıl butonları
        document.querySelectorAll('.leave-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.closest('.leave-btn').dataset.id;
                try {
                    const response = await fetch(`/api/turnuvalar/${id}/ayril`, {
                        method: 'POST',
                        credentials: 'include'
                    });
                    
                    const data = await response.json();
                    
                    if (!response.ok) {
                        alert(data.error || 'Turnuvadan ayrılırken bir hata oluştu.');
                        return;
                    }
                    
                    alert('Turnuvadan başarıyla ayrıldınız.');
                    loadTournaments(); // Turnuvaları yenile
                } catch (error) {
                    console.error('Turnuvadan ayrılma hatası:', error);
                    alert('Turnuvadan ayrılırken bir hata oluştu.');
                }
            });
        });
        
        // Başlat butonları
        document.querySelectorAll('.start-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.closest('.start-btn').dataset.id;
                try {
                    const response = await fetch(`/api/turnuvalar/${id}/baslat`, {
                        method: 'POST',
                        credentials: 'include'
                    });
                    
                    const data = await response.json();
                    
                    if (!response.ok) {
                        alert(data.error || 'Turnuva başlatılırken bir hata oluştu.');
                        return;
                    }
                    
                    alert('Turnuva başarıyla başlatıldı!');
                    loadTournaments(); // Turnuvaları yenile
                } catch (error) {
                    console.error('Turnuva başlatma hatası:', error);
                    alert('Turnuva başlatılırken bir hata oluştu.');
                }
            });
        });
    }
    
    // Çıkış yap
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
    
    // Turnuva oluştur
    async function createTournament(e) {
        e.preventDefault();
        
        // Form verilerini al
        const name = document.getElementById('tournament-name').value;
        const description = document.getElementById('tournament-desc').value;
        const startTime = document.getElementById('tournament-start').value;
        const maxParticipants = document.getElementById('max-participants').value;
        const rounds = document.getElementById('rounds').value;
        const timeControl = document.getElementById('time-control').value;
        
        // Validation
        if (!name || !startTime) {
            tournamentError.textContent = 'Turnuva adı ve başlangıç zamanı gereklidir.';
            tournamentError.style.display = 'block';
            return;
        }
        
        // Datetime kontrolü
        const tournamentStartTime = new Date(startTime);
        const now = new Date();
        if (tournamentStartTime <= now) {
            tournamentError.textContent = 'Başlangıç zamanı şu anki zamandan ileri olmalıdır.';
            tournamentError.style.display = 'block';
            return;
        }
        
        try {
            // Hata mesajını gizle
            tournamentError.style.display = 'none';
            
            const response = await fetch('/api/turnuvalar', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name,
                    description,
                    startTime,
                    maxParticipants,
                    rounds,
                    timeControl
                }),
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                tournamentError.textContent = data.error || 'Turnuva oluşturulurken bir hata oluştu.';
                tournamentError.style.display = 'block';
                return;
            }
            
            // Modal'ı kapat ve formu sıfırla
            createTournamentModal.style.display = 'none';
            tournamentForm.reset();
            
            // Turnuvaları yenile
            loadTournaments();
            
            // Başarı mesajı
            alert('Turnuva başarıyla oluşturuldu!');
            
        } catch (error) {
            console.error('Turnuva oluşturma hatası:', error);
            tournamentError.textContent = 'Turnuva oluşturulurken bir hata oluştu.';
            tournamentError.style.display = 'block';
        }
    }
    
    // Event Listeners
    if (createTournamentBtn) {
        createTournamentBtn.addEventListener('click', () => {
            createTournamentModal.style.display = 'flex';
        });
    }
    
    if (closeModal) {
        closeModal.addEventListener('click', () => {
            createTournamentModal.style.display = 'none';
        });
    }
    
    // Modal dışına tıklandığında kapat
    window.addEventListener('click', (e) => {
        if (e.target === createTournamentModal) {
            createTournamentModal.style.display = 'none';
        }
    });
    
    // Filtre değişikliklerinde turnuvaları yeniden filtrele
    statusFilter.addEventListener('change', filterTournaments);
    myTournamentsCheckbox.addEventListener('change', filterTournaments);
    
    // Turnuva formu gönderildiğinde
    tournamentForm.addEventListener('submit', createTournament);
    
    // Çıkış butonu
    logoutBtn.addEventListener('click', logout);
    
    // Sayfa yüklendiğinde kullanıcı bilgilerini yükle
    loadUserInfo();
});
