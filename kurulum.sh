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
  mkdir -p $INSTALL_DIR/{public,server,config/systemd,config/nginx,config/scripts}
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

# Systemd servis dosyasını oluştur
echo -e "${YELLOW}Systemd servis dosyası oluşturuluyor...${NC}"
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

# MongoDB yedekleme betiği
echo -e "${YELLOW}MongoDB yedekleme betiği oluşturuluyor...${NC}"
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

# Betiklere çalıştırma izni ver
chmod +x $INSTALL_DIR/config/scripts/backup.sh

# nodejs kullanıcısı oluştur
echo -e "${YELLOW}Node.js kullanıcısı oluşturuluyor...${NC}"
id -u nodejs &>/dev/null || useradd -r -m -s /bin/bash nodejs

# Dizin izinlerini ayarla
echo -e "${YELLOW}Dizin izinleri ayarlanıyor...${NC}"
# Server dizini oluşturulmadıysa oluştur
mkdir -p $INSTALL_DIR/server
chown -R nodejs:nodejs $INSTALL_DIR/server
chmod -R 750 $INSTALL_DIR/server

# Public dizini oluşturulmadıysa oluştur
mkdir -p $INSTALL_DIR/public
chown -R www-data:www-data $INSTALL_DIR/public
chmod -R 755 $INSTALL_DIR/public

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

# PM2 ecosystem dosyası oluştur
echo -e "${YELLOW}PM2 ecosystem.config.js dosyası oluşturuluyor...${NC}"
cat > $INSTALL_DIR/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: "turksatranc",
    script: "server/server.js",
    instances: "max",
    exec_mode: "cluster",
    watch: false,
    max_memory_restart: "300M",
    env: {
      NODE_ENV: "production",
      PORT: 5000
    },
    env_development: {
      NODE_ENV: "development",
      PORT: 5000
    },
    error_file: "logs/err.log",
    out_file: "logs/out.log",
    merge_logs: true,
    log_date_format: "YYYY-MM-DD HH:mm:ss"
  }]
};
EOF

# PM2 log dizini oluştur
mkdir -p $INSTALL_DIR/logs
chown nodejs:nodejs $INSTALL_DIR/logs

# Systemd servis dosyasını sistem üzerine kopyala
echo -e "${YELLOW}Systemd servis dosyası kopyalanıyor...${NC}"
cp $INSTALL_DIR/config/systemd/turksatranc.service /etc/systemd/system/

# Apache kurulu mu kontrol et ve gerekli modülleri etkinleştir
if [ -x "$(command -v apache2)" ]; then
    echo -e "${YELLOW}Apache kurulu, gerekli modüller etkinleştiriliyor...${NC}"
    
    # Gerekli Apache modüllerini etkinleştir
    a2enmod rewrite
    a2enmod proxy
    a2enmod proxy_http
    a2enmod headers
    a2enmod expires
    
    # Apache'yi yeniden başlat
    systemctl restart apache2
    
    echo -e "${GREEN}Apache yapılandırması tamamlandı.${NC}"
fi

# Nginx kurulu mu kontrol et
if [ -x "$(command -v nginx)" ]; then
    echo -e "${GREEN}Nginx kurulu.${NC}"
    # nginx config dosyasının kontrol edilmesi burada yapılmıyor
    # bu ayrı bir dosya olarak sağlanacak
fi

# PM2 ile uygulamayı başlat
echo -e "${YELLOW}PM2 ile uygulamayı başlatılıyor...${NC}"
cd $INSTALL_DIR
su - nodejs -c "cd $INSTALL_DIR && pm2 start ecosystem.config.js"

# PM2'yi sistem açılışında başlatacak şekilde ayarla
echo -e "${YELLOW}PM2 sistem açılışına ekleniyor...${NC}"
su - nodejs -c "pm2 save"
pm2 startup | tail -1 > /tmp/pm2_startup_cmd.sh
chmod +x /tmp/pm2_startup_cmd.sh
bash /tmp/pm2_startup_cmd.sh
rm /tmp/pm2_startup_cmd.sh

# Systemd servisini de etkinleştir (yedek olarak)
echo -e "${YELLOW}Systemd servisi de etkinleştiriliyor (yedek olarak)...${NC}"
systemctl daemon-reload
systemctl enable turksatranc.service
# Systemd servisi başlatılmıyor, PM2 yerine kullanılacak

echo -e "${GREEN}====================================================================${NC}"
echo -e "${GREEN}       TürkSatranç Sistemsel Bağımlılıkları Kuruldu!                ${NC}"
echo -e "${GREEN}====================================================================${NC}"
echo -e "${YELLOW}Uygulama dizini: ${NC}$INSTALL_DIR"
echo -e "${YELLOW}Systemd servis dosyası: ${NC}/etc/systemd/system/turksatranc.service"
echo -e "${YELLOW}PM2 durumu: ${NC}pm2 status"
echo -e "${YELLOW}PM2 log dosyaları: ${NC}$INSTALL_DIR/logs/"
echo -e "${YELLOW}Systemd yedek servis: ${NC}journalctl -u turksatranc.service"
echo -e "${YELLOW}MongoDB durumu: ${NC}systemctl status mongodb.service"
echo -e ""
echo -e "${YELLOW}PM2 komutları:${NC}"
echo -e "  pm2 restart turksatranc    # Uygulamayı yeniden başlat"
echo -e "  pm2 stop turksatranc       # Uygulamayı durdur"
echo -e "  pm2 logs turksatranc       # Canlı log izleme"
echo -e "  pm2 monit                  # Monitör ekranı"
echo -e ""
echo -e "${YELLOW}Not: Nginx yapılandırması ayrı olarak yapılmalıdır!${NC}"
echo -e "${GREEN}====================================================================${NC}"
