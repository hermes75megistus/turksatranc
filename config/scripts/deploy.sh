#!/bin/bash

# TürkSatranç Dağıtım Betiği
# Bu betik, TürkSatranç uygulamasını sunucuya dağıtmak için kullanılır

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

echo -e "${YELLOW}Servis yeniden başlatılıyor...${NC}"
systemctl restart turksatranc.service
sleep 2

# Servis durumunu kontrol et
if systemctl is-active --quiet turksatranc.service; then
  echo -e "${GREEN}Servis başarıyla yeniden başlatıldı.${NC}"
else
  echo -e "${RED}Servis başlatılamadı! Günlükleri kontrol edin:${NC}"
  journalctl -u turksatranc.service -n 20 --no-pager
fi

echo -e "${YELLOW}Web sunucusu yapılandırması test ediliyor...${NC}"

# Nginx varsa yapılandırmasını test et
if command -v nginx &> /dev/null; then
  nginx -t
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}Nginx yapılandırması geçerli.${NC}"
    echo -e "${YELLOW}Nginx yeniden başlatılıyor...${NC}"
    systemctl reload nginx
  else
    echo -e "${RED}Nginx yapılandırması hatalı!${NC}"
  fi
fi

# Apache varsa yapılandırmasını test et
if command -v apache2ctl &> /dev/null; then
  apache2ctl configtest
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}Apache yapılandırması geçerli.${NC}"
    echo -e "${YELLOW}Apache yeniden başlatılıyor...${NC}"
    systemctl reload apache2
  else
    echo -e "${RED}Apache yapılandırması hatalı!${NC}"
  fi
fi

echo -e "${GREEN}İşlem tamamlandı! Uygulama aşağıdaki adreste çalışıyor:${NC}"
echo -e "http://localhost:5000"
echo -e "${YELLOW}Servis günlükleri:${NC} journalctl -u turksatranc.service -f"

exit 0