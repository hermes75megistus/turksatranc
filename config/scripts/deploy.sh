#!/bin/bash

# TürkSatranç Dağıtım Betiği
# Bu betik, TürkSatranç uygulamasını güncellemek için kullanılır

# Renk kodları
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Ana dizin
APP_DIR="/var/www/turksatranc"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="${APP_DIR}/backups/deploy_${TIMESTAMP}"

# Yalnızca root veya sudo ile çalıştırılabilir
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Bu betik root izinleri gerektirir. 'sudo' ile çalıştırın.${NC}"
  exit 1
fi

echo -e "${GREEN}=== TürkSatranç Dağıtım Betiği - $(date) ===${NC}"

# Git kullanılıyorsa, en son sürümü çek (isteğe bağlı)
if [ -d "${APP_DIR}/.git" ]; then
  echo -e "${YELLOW}Git deposundan en son değişiklikler alınıyor...${NC}"
  cd ${APP_DIR}
  git pull
  if [ $? -ne 0 ]; then
    echo -e "${RED}Git güncellemesi başarısız!${NC}"
    echo -e "${YELLOW}Manuel güncelleme ile devam ediliyor...${NC}"
  fi
fi

# Yedekleme işlemi başlat
echo -e "${YELLOW}Mevcut uygulama yedekleniyor...${NC}"
mkdir -p ${BACKUP_DIR}

# Önemli dosya ve dizinleri yedekle
cp -r ${APP_DIR}/{public,server,.env,package.json,ecosystem.config.js} ${BACKUP_DIR}/
if [ $? -eq 0 ]; then
  echo -e "${GREEN}Yedekleme başarılı: ${BACKUP_DIR}${NC}"
else
  echo -e "${RED}Yedekleme başarısız! İşlem durduruluyor.${NC}"
  exit 1
fi

# NPM bağımlılıklarını güncelle
echo -e "${YELLOW}Bağımlılıklar güncelleniyor...${NC}"
cd ${APP_DIR}
npm install --production
if [ $? -ne 0 ]; then
  echo -e "${RED}Bağımlılık güncelleme hatası! İşlem durduruluyor.${NC}"
  echo -e "${YELLOW}Yedekten geri yükleme yapılıyor...${NC}"
  cp -r ${BACKUP_DIR}/* ${APP_DIR}/
  exit 1
fi

# İzinleri yenile
echo -e "${YELLOW}Dizin izinleri yenileniyor...${NC}"
chown -R nodejs:nodejs ${APP_DIR}/server
chown -R nodejs:nodejs ${APP_DIR}/node_modules
chown -R nodejs:nodejs ${APP_DIR}/logs
chown -R www-data:www-data ${APP_DIR}/public

# PM2 ile uygulamayı yeniden başlat
echo -e "${YELLOW}Uygulama yeniden başlatılıyor...${NC}"
cd ${APP_DIR}
su - nodejs -c "cd ${APP_DIR} && pm2 restart turksatranc"

# PM2 durumunu kontrol et
sleep 2
if su - nodejs -c "pm2 ls | grep -q turksatranc"; then
  PM2_STATUS=$(su - nodejs -c "pm2 ls | grep turksatranc | awk '{print \$10}'")
  if [[ "$PM2_STATUS" == "online" ]]; then
    echo -e "${GREEN}Uygulama başarıyla yeniden başlatıldı.${NC}"
  else
    echo -e "${RED}Uygulama başlatıldı ancak durumu: $PM2_STATUS${NC}"
    echo -e "${YELLOW}Logları kontrol edin:${NC} su - nodejs -c \"pm2 logs turksatranc --lines 20\""
  fi
else
  echo -e "${RED}Uygulama başlatılamadı! Yedekten geri yükleme yapılıyor...${NC}"
  cp -r ${BACKUP_DIR}/* ${APP_DIR}/
  su - nodejs -c "cd ${APP_DIR} && pm2 restart turksatranc"
  exit 1
fi

# Nginx yapılandırmasını test et
echo -e "${YELLOW}Nginx yapılandırması test ediliyor...${NC}"
nginx -t
if [ $? -eq 0 ]; then
  echo -e "${GREEN}Nginx yapılandırması geçerli.${NC}"
  echo -e "${YELLOW}Nginx yeniden başlatılıyor...${NC}"
  systemctl reload nginx
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}Nginx başarıyla yeniden yüklendi.${NC}"
  else
    echo -e "${RED}Nginx yeniden yükleme hatası!${NC}"
  fi
else
  echo -e "${RED}Nginx yapılandırması hatalı! Yapılandırmayı kontrol edin.${NC}"
fi

# MongoDB servisini kontrol et
echo -e "${YELLOW}MongoDB servisi kontrol ediliyor...${NC}"
if systemctl is-active --quiet mongod; then
  echo -e "${GREEN}MongoDB servisi aktif.${NC}"
else
  echo -e "${RED}MongoDB servisi çalışmıyor! Servis başlatılıyor...${NC}"
  systemctl start mongod
  if systemctl is-active --quiet mongod; then
    echo -e "${GREEN}MongoDB servisi başlatıldı.${NC}"
  else
    echo -e "${RED}MongoDB servisi başlatılamadı! Günlükleri kontrol edin:${NC}"
    journalctl -u mongod -n 20 --no-pager
  fi
fi

# Dağıtım özeti
echo -e "${GREEN}====================================================================${NC}"
echo -e "${GREEN}       TürkSatranç Dağıtımı Tamamlandı!                            ${NC}"
echo -e "${GREEN}====================================================================${NC}"
echo -e "${YELLOW}Sunucu durumu:${NC}"
echo -e "  - PM2: $(su - nodejs -c "pm2 ls | grep turksatranc | awk '{print \$10}'")"
echo -e "  - Nginx: $(systemctl is-active nginx)"
echo -e "  - MongoDB: $(systemctl is-active mongod)"
echo -e ""
echo -e "${YELLOW}Uygulamayı test edin:${NC} http://turksatranc.com"
echo -e "${YELLOW}PM2 günlükleri:${NC} su - nodejs -c \"pm2 logs turksatranc\""
echo -e "${YELLOW}Nginx hata günlüğü:${NC} tail -f /var/log/nginx/turksatranc.error.log"
echo -e "${YELLOW}Yedekler:${NC} ${BACKUP_DIR}"
echo -e "${GREEN}====================================================================${NC}"

exit 0
