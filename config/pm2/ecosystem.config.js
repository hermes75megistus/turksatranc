module.exports = {
  apps: [{
    name: 'turksatranc',
    script: 'server/server.js',
    cwd: '/var/www/turksatranc',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: 5000
    }
  }]
};