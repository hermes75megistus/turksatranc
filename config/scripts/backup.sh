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