#!/bin/bash

# TürkSatranç Sistemsel Bağımlılıklar Kurulum Betiği

# Renk tanımlamaları
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}====================================================================${NC}"
echo -e "${BLUE}          TürkSatranç Sistemsel Bağımlılıklar Kurulumu              ${NC}"
echo -e "${BLUE}====================================================================${NC}"

# Root izinlerini kontrol et
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Bu betik root izinleri gerektirir. 'sudo' ile çalıştırın.${NC}"
  exit 1
fi

# Kurulum dizini belirleme
INSTALL_DIR="/var/www/turksatranc"

# Ana dizin oluştur (eğer yoksa)
if [ ! -d "$INSTALL_DIR" ]; then
  echo -e "${YELLOW}Ana dizin oluşturuluyor: $INSTALL_DIR${NC}"
  mkdir -p $INSTALL_DIR/{public,server,config/{nginx,scripts,pm2},logs,backups}
  mkdir -p $INSTALL_DIR/public/{css,js,img/chesspieces/wikipedia}
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

# MongoDB çalışıyor mu kontrol et
if systemctl is-active --quiet mongod; then
  echo -e "${GREEN}MongoDB servisi aktif.${NC}"
else
  echo -e "${YELLOW}MongoDB servisi başlatılıyor...${NC}"
  systemctl start mongod
  systemctl enable mongod
fi

# Nginx kurulu mu kontrol et ve kur
if ! [ -x "$(command -v nginx)" ]; then
  echo -e "${YELLOW}Nginx kuruluyor...${NC}"
  apt update
  apt install -y nginx
else
  echo -e "${GREEN}Nginx kurulu.${NC}"
fi

# ImageMagick kurulu mu kontrol et (görseller için)
if ! [ -x "$(command -v convert)" ]; then
  echo -e "${YELLOW}ImageMagick kuruluyor...${NC}"
  apt update
  apt install -y imagemagick
else
  echo -e "${GREEN}ImageMagick kurulu.${NC}"
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
BASE_URL=http://turksatranc.com
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
    "socket.io": "^4.4.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "nodemon": "^2.0.15"
  }
}
EOF

# Nginx yapılandırma dosyasını oluştur
echo -e "${YELLOW}Nginx yapılandırma dosyası oluşturuluyor...${NC}"
cat > $INSTALL_DIR/config/nginx/turksatranc.conf << EOF
server {
    listen 80;
    server_name turksatranc.com www.turksatranc.com;
    
    # HTTPS'e yönlendirme (SSL sertifikanız olduğunda etkinleştirin)
    # return 301 https://\$host\$request_uri;
    
    # Statik içerik için root dizini
    root ${INSTALL_DIR}/public;
    
    # Socket.io WebSocket yönlendirmesi
    location /socket.io/ {
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header Host \$http_host;
        proxy_set_header X-NginX-Proxy true;
        
        proxy_pass http://localhost:5000/socket.io/;
        proxy_redirect off;
        
        # WebSocket desteği
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Bağlantı zaman aşımları
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
    
    # Statik dosyalar için cache
    location ~* \\.(jpg|jpeg|png|gif|ico|css|js|svg)\$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
        access_log off;
    }
    
    # API isteklerini Node.js'e yönlendir
    location /api/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
    
    # Ana uygulamayı yönlendir
    location / {
        try_files \$uri \$uri/ /index.html;
    }
    
    # 404 ve 500 hataları
    error_page 404 /404.html;
    location = /404.html {
        internal;
    }
    
    error_page 500 502 503 504 /500.html;
    location = /500.html {
        internal;
    }
    
    # Güvenlik başlıkları
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-XSS-Protection "1; mode=block";
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com 'unsafe-inline'; style-src 'self' https://cdnjs.cloudflare.com https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data:;";
    
    # Log dosyaları
    access_log /var/log/nginx/turksatranc.access.log;
    error_log /var/log/nginx/turksatranc.error.log;
}
EOF

# Yedekleme betiği
echo -e "${YELLOW}Yedekleme betiği oluşturuluyor...${NC}"
cat > $INSTALL_DIR/config/scripts/backup.sh << 'EOF'
#!/bin/bash

# TürkSatranç Yedekleme Betiği
# Bu betik, TürkSatranç uygulamasının veritabanı ve dosyalarını yedekler

# Renk kodları
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Ana dizin
APP_DIR="/var/www/turksatranc"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="${APP_DIR}/backups"
BACKUP_FILE="${BACKUP_DIR}/turksatranc_${TIMESTAMP}.tar.gz"

# Yedekleme dizini oluştur
mkdir -p ${BACKUP_DIR}

echo -e "${GREEN}=== TürkSatranç Yedekleme Betiği - $(date) ===${NC}"

# MongoDB veritabanını yedekle
if command -v mongodump &> /dev/null; then
    echo -e "${YELLOW}MongoDB veritabanı yedekleniyor...${NC}"
    MONGO_BACKUP_DIR="${BACKUP_DIR}/mongodb_${TIMESTAMP}"
    mkdir -p ${MONGO_BACKUP_DIR}
    
    mongodump --db turksatranc --out ${MONGO_BACKUP_DIR}
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}MongoDB yedekleme başarılı.${NC}"
    else
        echo -e "${RED}MongoDB yedekleme başarısız!${NC}"
    fi
else
    echo -e "${YELLOW}MongoDB komutları bulunamadı, veritabanı yedekleme atlanıyor.${NC}"
fi

# Uygulama dosyalarını yedekle
echo -e "${YELLOW}Uygulama dosyaları yedekleniyor...${NC}"
tar -czf ${BACKUP_FILE} \
    --exclude="node_modules" \
    --exclude=".git" \
    -C ${APP_DIR} \
    public server .env package.json

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Dosya yedekleme başarılı.${NC}"
    
    # MongoDB yedeğini de arşive ekle
    if [ -d "${MONGO_BACKUP_DIR}" ]; then
        tar -rf ${BACKUP_FILE} -C ${BACKUP_DIR} $(basename ${MONGO_BACKUP_DIR})
        rm -rf ${MONGO_BACKUP_DIR}
    fi
    
    # Yedek dosyasının boyutunu göster
    FILESIZE=$(du -h ${BACKUP_FILE} | cut -f1)
    echo -e "${GREEN}Yedek dosyası oluşturuldu: ${BACKUP_FILE} (${FILESIZE})${NC}"
else
    echo -e "${RED}Dosya yedekleme başarısız!${NC}"
fi

# Eski yedekleri temizle (son 5 yedek tutulur)
echo -e "${YELLOW}Eski yedekler temizleniyor...${NC}"
ls -t ${BACKUP_DIR}/turksatranc_*.tar.gz | tail -n +6 | xargs -r rm
echo -e "${GREEN}Yedekleme işlemi tamamlandı.${NC}"

exit 0
EOF

# Dağıtım betiği
echo -e "${YELLOW}Dağıtım betiği oluşturuluyor...${NC}"
cat > $INSTALL_DIR/config/scripts/deploy.sh << 'EOF'
#!/bin/bash

# TürkSatranç Dağıtım Betiği
# Bu betik, TürkSatranç uygulamasının güncellenmesi için kullanılır

# Renk kodları
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Ana dizin
APP_DIR="/var/www/turksatranc"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="${APP_DIR}/backups/backup_${TIMESTAMP}"

# Yalnızca root veya sudo ile çalıştırılabilir
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Bu betik root izinleri gerektirir. 'sudo' ile çalıştırın.${NC}"
  exit 1
fi

echo -e "${GREEN}=== TürkSatranç Dağıtım Betiği - $(date) ===${NC}"
echo -e "${YELLOW}Yedekleme işlemi başlatılıyor...${NC}"

# Önce yedek al
mkdir -p ${BACKUP_DIR}
cp -r ${APP_DIR}/{public,server,.env,package.json} ${BACKUP_DIR}/

echo -e "${YELLOW}Bağımlılıkları yükleniyor...${NC}"
cd ${APP_DIR}
npm install --production

echo -e "${YELLOW}PM2 ile servis yeniden başlatılıyor...${NC}"
cd ${APP_DIR}
su - nodejs -c "cd ${APP_DIR} && pm2 restart turksatranc"

# PM2 durumunu kontrol et
if su - nodejs -c "pm2 ls | grep -q turksatranc"; then
  echo -e "${GREEN}PM2 servisi başarıyla yeniden başlatıldı.${NC}"
else
  echo -e "${RED}PM2 servisi başlatılamadı! Günlükleri kontrol edin:${NC}"
  su - nodejs -c "pm2 logs turksatranc --lines 20"
fi

echo -e "${YELLOW}Nginx yapılandırması test ediliyor...${NC}"
nginx -t

if [ $? -eq 0 ]; then
  echo -e "${GREEN}Nginx yapılandırması geçerli.${NC}"
  echo -e "${YELLOW}Nginx yeniden başlatılıyor...${NC}"
  systemctl reload nginx
else
  echo -e "${RED}Nginx yapılandırması hatalı!${NC}"
fi

echo -e "${GREEN}Güncelleme işlemi tamamlandı! Uygulama aşağıdaki adreste çalışıyor:${NC}"
echo -e "http://turksatranc.com"
echo -e "${YELLOW}PM2 günlükleri:${NC} su - nodejs -c \"pm2 logs turksatranc\""

exit 0
EOF

# PM2 ecosystem dosyası oluştur
echo -e "${YELLOW}PM2 ecosystem.config.js dosyası oluşturuluyor...${NC}"
cat > $INSTALL_DIR/ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: "turksatranc",
    script: "server/server.js",
    instances: 1,
    exec_mode: "fork",
    watch: false,
    max_memory_restart: "500M",
    env: {
      NODE_ENV: "production",
      PORT: 5000
    },
    error_file: "logs/err.log",
    out_file: "logs/out.log",
    merge_logs: true,
    log_date_format: "YYYY-MM-DD HH:mm:ss"
  }]
};
EOF

# nodejs kullanıcısı oluştur
echo -e "${YELLOW}Node.js kullanıcısı oluşturuluyor...${NC}"
id -u nodejs &>/dev/null || useradd -r -m -s /bin/bash nodejs

# Betiklere çalıştırma izni ver
echo -e "${YELLOW}Betiklere çalıştırma izni veriliyor...${NC}"
chmod +x $INSTALL_DIR/config/scripts/backup.sh
chmod +x $INSTALL_DIR/config/scripts/deploy.sh

# Dizin izinlerini ayarla
echo -e "${YELLOW}Dizin izinleri ayarlanıyor...${NC}"
mkdir -p $INSTALL_DIR/server
mkdir -p $INSTALL_DIR/public
mkdir -p $INSTALL_DIR/logs

# Satranç taşı resimleri için dizin
mkdir -p $INSTALL_DIR/public/img/chesspieces/wikipedia

# Satranç taşı resimlerini oluştur
echo -e "${YELLOW}Satranç taşı görselleri oluşturuluyor...${NC}"
if [ -x "$(command -v convert)" ]; then
  for piece in P R N B Q K; do
    # Beyaz taşlar
    convert -size 100x100 xc:white -fill black -gravity center -pointsize 60 -annotate 0 "w$piece" $INSTALL_DIR/public/img/chesspieces/wikipedia/w$piece.png
    # Siyah taşlar
    convert -size 100x100 xc:black -fill white -gravity center -pointsize 60 -annotate 0 "b$piece" $INSTALL_DIR/public/img/chesspieces/wikipedia/b$piece.png
  done
  echo -e "${GREEN}Geçici satranç taşı görselleri oluşturuldu.${NC}"
else
  echo -e "${YELLOW}ImageMagick bulunamadı, satranç taşı görselleri oluşturulamadı.${NC}"
  echo -e "${YELLOW}Lütfen satranç taşı görsellerini manuel olarak yükleyin: /public/img/chesspieces/wikipedia/wP.png vb.${NC}"
fi

# NPM bağımlılıklarını yükle
echo -e "${YELLOW}NPM bağımlılıkları yükleniyor...${NC}"
cd $INSTALL_DIR
npm install --production

# PM2 kurulumu
if ! [ -x "$(command -v pm2)" ]; then
  echo -e "${YELLOW}PM2 Process Manager kuruluyor...${NC}"
  npm install -g pm2
else
  echo -e "${GREEN}PM2 zaten kurulu.${NC}"
  pm2 --version
fi

# Dizin izinlerini ayarla
chown -R nodejs:nodejs $INSTALL_DIR/server
chown -R nodejs:nodejs $INSTALL_DIR/node_modules
chown -R nodejs:nodejs $INSTALL_DIR/logs
chown -R nodejs:nodejs $INSTALL_DIR/ecosystem.config.js
chown -R www-data:www-data $INSTALL_DIR/public

# Nginx yapılandırmasını kopyala
echo -e "${YELLOW}Nginx yapılandırması kopyalanıyor...${NC}"
cp $INSTALL_DIR/config/nginx/turksatranc.conf /etc/nginx/sites-available/

# Mevcut default site'yi devre dışı bırak ve bizim sitemizi etkinleştir
if [ -f /etc/nginx/sites-enabled/default ]; then
  rm /etc/nginx/sites-enabled/default
fi

ln -sf /etc/nginx/sites-available/turksatranc.conf /etc/nginx/sites-enabled/

# Nginx yapılandırmasını test et
nginx -t

if [ $? -eq 0 ]; then
  # Nginx'i yeniden başlat
  systemctl restart nginx
  echo -e "${GREEN}Nginx yapılandırması başarıyla uygulandı.${NC}"
else
  echo -e "${RED}Nginx yapılandırması hatalı! Lütfen /etc/nginx/sites-available/turksatranc.conf dosyasını kontrol edin.${NC}"
fi

# PM2 ile uygulamayı başlat
echo -e "${YELLOW}PM2 ile uygulamayı başlatılıyor...${NC}"
cd $INSTALL_DIR
su - nodejs -c "cd $INSTALL_DIR && pm2 start ecosystem.config.js"

# PM2'yi sistem açılışında başlatacak şekilde ayarla
echo -e "${YELLOW}PM2 sistem açılışına ekleniyor...${NC}"
su - nodejs -c "pm2 save"
pm2 startup systemd -u nodejs --hp /home/nodejs

echo -e "${GREEN}====================================================================${NC}"
echo -e "${GREEN}       TürkSatranç Kurulumu Tamamlandı!                            ${NC}"
echo -e "${GREEN}====================================================================${NC}"
echo -e "${YELLOW}Uygulama dizini: ${NC}$INSTALL_DIR"
echo -e "${YELLOW}Nginx yapılandırması: ${NC}/etc/nginx/sites-available/turksatranc.conf"
echo -e "${YELLOW}PM2 durumu: ${NC}su - nodejs -c \"pm2 status\""
echo -e "${YELLOW}PM2 log dosyaları: ${NC}$INSTALL_DIR/logs/"
echo -e "${YELLOW}MongoDB durumu: ${NC}systemctl status mongod"
echo -e ""
echo -e "${YELLOW}PM2 komutları:${NC}"
echo -e "  su - nodejs -c \"pm2 restart turksatranc\"    # Uygulamayı yeniden başlat"
echo -e "  su - nodejs -c \"pm2 stop turksatranc\"       # Uygulamayı durdur"
echo -e "  su - nodejs -c \"pm2 logs turksatranc\"       # Canlı log izleme"
echo -e "  su - nodejs -c \"pm2 monit\"                  # Monitör ekranı"
echo -e ""
echo -e "${YELLOW}Uygulama artık http://turksatranc.com adresinde çalışıyor olmalı.${NC}"
echo -e "${YELLOW}DNS ayarlarınızı kontrol edin ve gerekirse bir SSL sertifikası ekleyin.${NC}"
echo -e "${GREEN}====================================================================${NC}"
