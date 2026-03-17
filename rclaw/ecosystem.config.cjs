module.exports = {
  apps: [
    {
      name: "rclaw",
      script: "npx",
      args: "tsx src/index.ts",
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
