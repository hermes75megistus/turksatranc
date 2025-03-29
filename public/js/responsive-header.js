// Responsive Header - Hamburger Menu Functionality
document.addEventListener('DOMContentLoaded', function() {
    // Header'a hamburger menü ekle
    const headerContainer = document.querySelector('.main-header .container');
    if (headerContainer) {
        // Hamburger menü düğmesi oluştur
        const hamburgerButton = document.createElement('button');
        hamburgerButton.className = 'hamburger-menu';
        hamburgerButton.setAttribute('aria-label', 'Ana Menüyü Aç/Kapat');
        hamburgerButton.innerHTML = `
            <span></span>
            <span></span>
            <span></span>
        `;
        
        // Hamburger düğmesini header'a ekle (logo ve user-controls arasına)
        const logo = headerContainer.querySelector('.logo');
        if (logo) {
            headerContainer.insertBefore(hamburgerButton, logo.nextSibling);
        } else {
            headerContainer.prepend(hamburgerButton);
        }
        
        // Ana navigasyon elementini bul
        const mainNav = document.querySelector('.main-nav');
        
        // Hamburger menü tıklama olayını ekle
        hamburgerButton.addEventListener('click', function() {
            // Hamburger icon durumunu değiştir
            this.classList.toggle('active');
            
            // Ana menüyü aç/kapat
            if (mainNav) {
                mainNav.classList.toggle('active');
            }
        });
        
        // Menü dışına tıklandığında menüyü kapat
        document.addEventListener('click', function(event) {
            if (!event.target.closest('.main-nav') && 
                !event.target.closest('.hamburger-menu') && 
                mainNav && 
                mainNav.classList.contains('active')) {
                
                mainNav.classList.remove('active');
                hamburgerButton.classList.remove('active');
            }
        });
        
        // Pencere boyutu değiştiğinde kontrol et
        window.addEventListener('resize', function() {
            if (window.innerWidth > 768 && mainNav && mainNav.classList.contains('active')) {
                mainNav.classList.remove('active');
                hamburgerButton.classList.remove('active');
            }
        });
    }
});
