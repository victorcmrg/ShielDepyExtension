DISPLAY_NAME=ShielDepy
DESCRIPTION=Site e portal do ShielDepy
MAIN=start.mjs
MEMORY=512
VERSION=recommended
SUBDOMAIN=shieldepy
AUTORESTART=true
START=node --import tsx start.mjs
