#!/bin/bash

# TürkSatranç Kurulum ve Çalıştırma Betiği

# Renk tanımlamaları
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}====================================================================${NC}"
echo -e "${BLUE}                TürkSatranç Kurulum ve Çalıştırma                   ${NC}"
echo -e "${BLUE}====================================================================${NC}"

# Kurulum dizini belirleme
INSTALL_DIR="/var/www/turksatranc"
BACKUP_DIR="/var/www/turksatranc_backup_$(date +%Y%m%d%H%M%S)"

# Root izinlerini kontrol et
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Bu betik root izinleri gerektirir. 'sudo' ile çalıştırın.${NC}"
  exit 1
fi

# Eğer kurulum dizini zaten varsa, yedek al
if [ -d "$INSTALL_DIR" ]; then
  echo -e "${YELLOW}Mevcut kurulum bulundu. Yedek alınıyor: $BACKUP_DIR${NC}"
  mkdir -p "$BACKUP_DIR"
  cp -r "$INSTALL_DIR"/* "$BACKUP_DIR"
else
  # Ana dizin ve alt dizinleri oluşturma
  echo -e "${YELLOW}Ana dizinler oluşturuluyor...${NC}"
  mkdir -p $INSTALL_DIR/{public,server,public/css,public/js,public/img,config/systemd,config/nginx,config/apache,config/scripts}
fi

cd $INSTALL_DIR

# Gerekli bağımlılıkları kontrol et ve kur
echo -e "${YELLOW}Gerekli bağımlılıklar kontrol ediliyor ve kuruluyor...${NC}"

# Node.js ve npm kurulu mu kontrol et
if ! [ -x "$(command -v node)" ]; then
  echo -e "${RED}Node.js bulunamadı. Kurulum yapılıyor...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
  apt install -y nodejs
else
  NODE_VERSION=$(node -v)
  echo -e "${GREEN}Node.js kurulu: $NODE_VERSION${NC}"
fi

# MongoDB kurulu mu kontrol et
if ! [ -x "$(command -v mongod)" ]; then
  echo -e "${RED}MongoDB bulunamadı. Kurulum yapılıyor...${NC}"
  wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | apt-key add -
  echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/6.0 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-6.0.list
  apt update
  apt install -y mongodb-org
  systemctl start mongod
  systemctl enable mongod
else
  echo -e "${GREEN}MongoDB kurulu.${NC}"
  # MongoDB servisini başlat
  systemctl start mongod
  systemctl status mongod --no-pager
fi

# .env dosyası oluştur
echo -e "${YELLOW}.env dosyası oluşturuluyor...${NC}"
cat > $INSTALL_DIR/.env << 'EOF'
# Database Configuration
MONGODB_URI=mongodb://127.0.0.1:27017/turksatranc

# Session Configuration
SESSION_SECRET=turksatranc-super-secure-session-key-2025

# Server Configuration
PORT=5000
NODE_ENV=production
EOF

# package.json oluşturma
echo -e "${YELLOW}package.json oluşturuluyor...${NC}"
cat > $INSTALL_DIR/package.json << 'EOF'
{
  "name": "turksatranc",
  "version": "1.0.0",
  "description": "Türk kültürüne uygun satranç oyunu platformu",
  "main": "server/server.js",
  "scripts": {
    "start": "node server/server.js",
    "dev": "nodemon server/server.js"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "body-parser": "^1.19.0",
    "connect-mongo": "^4.6.0",
    "cookie-parser": "^1.4.5",
    "dotenv": "^16.0.3",
    "express": "^4.17.1",
    "express-session": "^1.17.2",
    "mongoose": "^6.0.12",
    "socket.io": "^4.4.0"
  },
  "devDependencies": {
    "nodemon": "^2.0.15"
  }
}
EOF

# Sistem yapılandırma dosyalarını oluştur
echo -e "${YELLOW}Sistem yapılandırma dosyaları oluşturuluyor...${NC}"

# Systemd servis dosyasını oluştur
cat > $INSTALL_DIR/config/systemd/turksatranc.service << EOF
[Unit]
Description=TürkSatranç Online Chess Application
After=network.target mongodb.service

[Service]
Type=simple
User=nodejs
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node $INSTALL_DIR/server/server.js
Restart=on-failure
Environment=NODE_ENV=production
Environment=PORT=5000

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

[Install]
WantedBy=multi-user.target
EOF

# Nginx yapılandırması
cat > $INSTALL_DIR/config/nginx/turksatranc.conf << EOF
server {
    listen 80;
    server_name turksatranc.com www.turksatranc.com;
    
    # HTTP'den HTTPS'e yönlendirme
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name turksatranc.com www.turksatranc.com;
    
    # SSL sertifika yolları (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/turksatranc.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/turksatranc.com/privkey.pem;
    
    # SSL ayarları
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # Ek güvenlik başlıkları
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-XSS-Protection "1; mode=block";
    
    # Root dizini
    root $INSTALL_DIR/public;
    
    # Proxy ve header ayarları
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    
    # Statik dosyalar
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
        try_files \$uri =404;
    }
    
    # Socket.io için WebSocket desteği
    location /socket.io/ {
        proxy_pass http://localhost:5000;
    }
    
    # API istekleri ve diğer tüm içerik için proxy
    location / {
        proxy_pass http://localhost:5000;
        proxy_buffering off;
        
        # Uzun bağlantılar için timeout ayarları
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }
    
    # Loglama
    access_log /var/log/nginx/turksatranc.access.log;
    error_log /var/log/nginx/turksatranc.error.log;
}
EOF

# Apache .htaccess dosyası
cat > $INSTALL_DIR/config/apache/.htaccess << 'EOF'
# TürkSatranç .htaccess Dosyası

# Rewrite engine'i aktif et
RewriteEngine On

# SSL yönlendirmesi
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

# Güvenlik başlıkları
<IfModule mod_headers.c>
    # XSS Koruması
    Header set X-XSS-Protection "1; mode=block"
    # Clickjacking koruması
    Header set X-Frame-Options "SAMEORIGIN"
    # MIME-type sniffing koruması
    Header set X-Content-Type-Options "nosniff"
    # Referrer Policy
    Header set Referrer-Policy "strict-origin-when-cross-origin"
    # Content Security Policy (CSP)
    Header set Content-Security-Policy "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com 'unsafe-inline'; style-src 'self' https://cdnjs.cloudflare.com https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data:; connect-src 'self' wss://%{HTTP_HOST}"
</IfModule>

# Gzip sıkıştırma
<IfModule mod_deflate.c>
    AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript application/javascript application/json application/x-javascript
</IfModule>

# Tarayıcı önbelleği
<IfModule mod_expires.c>
    ExpiresActive On
    ExpiresByType image/jpg "access plus 1 year"
    ExpiresByType image/jpeg "access plus 1 year"
    ExpiresByType image/gif "access plus 1 year"
    ExpiresByType image/png "access plus 1 year"
    ExpiresByType image/svg+xml "access plus 1 year"
    ExpiresByType text/css "access plus 1 month"
    ExpiresByType application/javascript "access plus 1 month"
    ExpiresByType text/javascript "access plus 1 month"
    ExpiresByType application/x-javascript "access plus 1 month"
    ExpiresByType text/html "access plus 1 day"
    ExpiresByType application/xhtml+xml "access plus 1 day"
</IfModule>

# .htaccess'e erişimi engelle
<Files .htaccess>
    Order Allow,Deny
    Deny from all
</Files>

# Dizin listelemeyi kapat
Options -Indexes

# Node.js uygulamasına yönlendirme
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteRule ^$ http://localhost:5000/ [P,L]
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule ^(.*)$ http://localhost:5000/$1 [P,L]
</IfModule>

# 404 sayfası
ErrorDocument 404 /404.html

# 500 sayfası
ErrorDocument 500 /500.html
EOF

# Deploy betiği
cat > $INSTALL_DIR/config/scripts/deploy.sh << 'EOF'
#!/bin/bash

# TürkSatranç Dağıtım Betiği

# Renk tanımlamaları
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}====================================================================${NC}"
echo -e "${BLUE}                TürkSatranç Dağıtım Betiği                          ${NC}"
echo -e "${BLUE}====================================================================${NC}"

# Dağıtım dizini
INSTALL_DIR="/var/www/turksatranc"
cd $INSTALL_DIR

# Git kullanılıyorsa güncellemeleri çek
if [ -d ".git" ]; then
    echo -e "${YELLOW}Git güncellemeleri çekiliyor...${NC}"
    git pull
fi

# NPM bağımlılıklarını güncelle
echo -e "${YELLOW}NPM bağımlılıkları güncelleniyor...${NC}"
npm install --production

# Yapılandırma dosyalarını kopyala
echo -e "${YELLOW}Yapılandırma dosyaları kopyalanıyor...${NC}"
sudo cp $INSTALL_DIR/config/systemd/turksatranc.service /etc/systemd/system/
sudo cp $INSTALL_DIR/config/nginx/turksatranc.conf /etc/nginx/sites-available/
sudo cp $INSTALL_DIR/config/apache/.htaccess $INSTALL_DIR/public/.htaccess

# Systemd yeniden yükle ve servisi yeniden başlat
echo -e "${YELLOW}Servis yeniden başlatılıyor...${NC}"
sudo systemctl daemon-reload
sudo systemctl restart turksatranc.service

# Nginx yapılandırmasını kontrol et ve yeniden yükle
sudo nginx -t
if [ $? -eq 0 ]; then
    echo -e "${YELLOW}Nginx yeniden başlatılıyor...${NC}"
    sudo systemctl restart nginx
else
    echo -e "${RED}Nginx yapılandırma hatası bulundu!${NC}"
    exit 1
fi

# Apache'yi kontrol et ve yeniden başlat
if [ -x "$(command -v apache2)" ]; then
    sudo apache2ctl configtest
    if [ $? -eq 0 ]; then
        echo -e "${YELLOW}Apache yeniden başlatılıyor...${NC}"
        sudo systemctl restart apache2
    else
        echo -e "${RED}Apache yapılandırma hatası bulundu!${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}====================================================================${NC}"
echo -e "${GREEN}       TürkSatranç Dağıtımı Başarıyla Tamamlandı!                  ${NC}"
echo -e "${GREEN}====================================================================${NC}"
EOF

# Backup betiği
cat > $INSTALL_DIR/config/scripts/backup.sh << 'EOF'
#!/bin/bash

# TürkSatranç MongoDB Yedekleme Betiği

# Yedekleme dizini
BACKUP_DIR="/var/www/turksatranc/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/turksatranc_$TIMESTAMP.gz"

# Yedekleme dizini oluştur
mkdir -p $BACKUP_DIR

# MongoDB yedekle
mongodump --db turksatranc --archive=$BACKUP_FILE --gzip

# Eski yedeklemeleri temizle (30 günden eski)
find $BACKUP_DIR -name "turksatranc_*.gz" -type f -mtime +30 -delete

echo "Yedekleme tamamlandı: $BACKUP_FILE"
EOF

# 404 ve 500 hata sayfalarını oluştur
cat > $INSTALL_DIR/public/404.html << 'EOF'
<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sayfa Bulunamadı - TürkSatranç</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.1/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Kaushan+Script&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/css/style.css">
    <link rel="shortcut icon" href="/img/favicon.ico" type="image/x-icon">
    <style>
        .error-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 50px 20px;
            min-height: 50vh;
        }
        .error-icon {
            font-size: 6rem;
            color: #c81912;
            margin-bottom: 20px;
        }
        .error-title {
            font-size: 2.5rem;
            color: #333;
            margin-bottom: 15px;
        }
        .error-message {
            font-size: 1.2rem;
            color: #666;
            margin-bottom: 30px;
            max-width: 600px;
        }
        .error-actions {
            display: flex;
            gap: 20px;
        }
    </style>
</head>
<body>
    <div class="site-wrapper">
        <header class="main-header">
            <div class="container">
                <div class="logo">
                    <a href="/">
                        <img src="/img/logo.png" alt="Türk Satranç Logo">
                        <span>TürkSatranç</span>
                    </a>
                </div>
            </div>
        </header>
        
        <main class="container">
            <div class="error-container turkish-pattern-light">
                <div class="error-icon">
                    <i class="fas fa-chess-knight"></i>
                </div>
                <h1 class="error-title">404 - Sayfa Bulunamadı</h1>
                <p class="error-message">
                    Aradığınız sayfa bulunamadı. Sayfanın taşınmış veya silinmiş olabilir.
                </p>
                <div class="error-actions">
                    <a href="/" class="btn primary-btn"><i class="fas fa-home"></i> Ana Sayfa</a>
                    <a href="javascript:history.back()" class="btn secondary-btn"><i class="fas fa-arrow-left"></i> Geri Dön</a>
                </div>
            </div>
        </main>
        
        <footer class="main-footer">
            <div class="container">
                <div class="footer-content">
                    <div class="copyright">
                        <p>&copy; 2025 TürkSatranç - Tüm hakları saklıdır.</p>
                    </div>
                </div>
            </div>
        </footer>
    </div>
</body>
</html>
EOF

cat > $INSTALL_DIR/public/500.html << 'EOF'
<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sunucu Hatası - TürkSatranç</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.1/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Kaushan+Script&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/css/style.css">
    <link rel="shortcut icon" href="/img/favicon.ico" type="image/x-icon">
    <style>
        .error-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 50px 20px;
            min-height: 50vh;
        }
        .error-icon {
            font-size: 6rem;
            color: #c81912;
            margin-bottom: 20px;
        }
        .error-title {
            font-size: 2.5rem;
            color: #333;
            margin-bottom: 15px;
        }
        .error-message {
            font-size: 1.2rem;
            color: #666;
            margin-bottom: 30px;
            max-width: 600px;
        }
        .error-actions {
            display: flex;
            gap: 20px;
        }
    </style>
</head>
<body>
    <div class="site-wrapper">
        <header class="main-header">
            <div class="container">
                <div class="logo">
                    <a href="/">
                        <img src="/img/logo.png" alt="Türk Satranç Logo">
                        <span>TürkSatranç</span>
                    </a>
                </div>
            </div>
        </header>
        
        <main class="container">
            <div class="error-container turkish-pattern-light">
                <div class="error-icon">
                    <i class="fas fa-exclamation-triangle"></i>
                </div>
                <h1 class="error-title">500 - Sunucu Hatası</h1>
                <p class="error-message">
                    Üzgünüz, isteğiniz işlenirken bir hata oluştu. Teknik ekibimiz bu sorun üzerinde çalışıyor.
                </p>
                <div class="error-actions">
                    <a href="/" class="btn primary-btn"><i class="fas fa-home"></i> Ana Sayfa</a>
                    <a href="javascript:location.reload()" class="btn secondary-btn"><i class="fas fa-sync-alt"></i> Yenile</a>
                </div>
            </div>
        </main>
        
        <footer class="main-footer">
            <div class="container">
                <div class="footer-content">
                    <div class="copyright">
                        <p>&copy; 2025 TürkSatranç - Tüm hakları saklıdır.</p>
                    </div>
                </div>
            </div>
        </footer>
    </div>
</body>
</html>
EOF

# Script dosyalarına çalıştırma izni ver
chmod +x $INSTALL_DIR/config/scripts/deploy.sh
chmod +x $INSTALL_DIR/config/scripts/backup.sh

# Gerekli dizinlere izinleri ayarla
echo -e "${YELLOW}Dizin izinleri ayarlanıyor...${NC}"
chown -R www-data:www-data $INSTALL_DIR/public
chmod -R 755 $INSTALL_DIR/public
chmod -R 644 $INSTALL_DIR/public/*
chmod 755 $INSTALL_DIR/public
chmod 755 $INSTALL_DIR/public/css
chmod 755 $INSTALL_DIR/public/js
chmod 755 $INSTALL_DIR/public/img

# nodejs kullanıcısı oluştur
echo -e "${YELLOW}Node.js kullanıcısı oluşturuluyor...${NC}"
id -u nodejs &>/dev/null || useradd -r -m -s /bin/bash nodejs
chown -R nodejs:nodejs $INSTALL_DIR/server
chmod -R 750 $INSTALL_DIR/server

# NPM bağımlılıklarını yükle
echo -e "${YELLOW}NPM bağımlılıkları yükleniyor...${NC}"
cd $INSTALL_DIR
npm install --production

# Systemd servis dosyasını sistem üzerine kopyala
echo -e "${YELLOW}Systemd servis dosyası kopyalanıyor...${NC}"
cp $INSTALL_DIR/config/systemd/turksatranc.service /etc/systemd/system/

# Nginx yapılandırmasını sistem üzerine kopyala
echo -e "${YELLOW}Nginx yapılandırması kopyalanıyor...${NC}"
cp $INSTALL_DIR/config/nginx/turksatranc.conf /etc/nginx/sites-available/

# Apache kurulu mu kontrol et ve gerekli modülleri etkinleştir
if [ -x "$(command -v apache2)" ]; then
    echo -e "${YELLOW}Apache kurulu, gerekli modüller etkinleştiriliyor...${NC}"
    
    # Gerekli Apache modüllerini etkinleştir
    a2enmod rewrite
    a2enmod proxy
    a2enmod proxy_http
    a2enmod headers
    a2enmod expires
    
    # Apache .htaccess dosyasını public dizinine kopyala
    echo -e "${YELLOW}Apache .htaccess dosyası kopyalanıyor...${NC}"
    cp $INSTALL_DIR/config/apache/.htaccess $INSTALL_DIR/public/.htaccess
    
    # Apache'yi yeniden başlat
    systemctl restart apache2
    
    echo -e "${GREEN}Apache yapılandırması tamamlandı.${NC}"
else
    echo -e "${YELLOW}Apache kurulu değil, .htaccess dosyası kopyalanıyor...${NC}"
    # Apache kurulu olmasa bile .htaccess dosyasını kopyala (ileride gerekebilir)
    cp $INSTALL_DIR/config/apache/.htaccess $INSTALL_DIR/public/.htaccess
fi

# Servisi etkinleştir ve başlat
echo -e "${YELLOW}Servisi etkinleştirme ve başlatma...${NC}"
systemctl daemon-reload
systemctl enable turksatranc.service
systemctl start turksatranc.service
systemctl status turksatranc.service --no-pager

# Nginx yapılandırmasını etkinleştir ve yeniden başlat
echo -e "${YELLOW}Nginx yapılandırması etkinleştiriliyor...${NC}"
if [ -f "/etc/nginx/sites-enabled/turksatranc.conf" ]; then
    rm /etc/nginx/sites-enabled/turksatranc.conf
fi
ln -s /etc/nginx/sites-available/turksatranc.conf /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx

# SSL sertifikası kontrol et ve gerekiyorsa oluştur
if [ ! -d "/etc/letsencrypt/live/turksatranc.com" ]; then
    echo -e "${YELLOW}SSL sertifikası oluşturuluyor...${NC}"
    apt-get install -y certbot python3-certbot-nginx
    certbot --nginx -d turksatranc.com -d www.turksatranc.com --non-interactive --agree-tos --email admin@turksatranc.com
fi

echo -e "${GREEN}====================================================================${NC}"
echo -e "${GREEN}       TürkSatranç Kurulumu Başarıyla Tamamlandı!                  ${NC}"
echo -e "${GREEN}====================================================================${NC}"
echo -e "Uygulama şu adreste çalışıyor: ${BLUE}https://turksatranc.com${NC}"
echo -e "Uygulama şu adreste çalışıyor: ${BLUE}http://localhost:5000${NC}"
echo -e "${YELLOW}Nginx yapılandırması: ${NC}/etc/nginx/sites-available/turksatranc.conf"
echo -e "${YELLOW}Systemd servis dosyası: ${NC}/etc/systemd/system/turksatranc.service"
echo -e "${YELLOW}Uygulama dizini: ${NC}$INSTALL_DIR"
echo -e "${YELLOW}Uygulama logları: ${NC}journalctl -u turksatranc.service"
echo -e "${YELLOW}MongoDB durumu: ${NC}systemctl status mongodb.service"
echo -e "${GREEN}====================================================================${NC}"