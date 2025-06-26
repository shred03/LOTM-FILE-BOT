// plugins/stats.js
const User = require('../models/User');
const File = require('../models/File');
const Admin = require('../models/Admin');
const os = require('os');
const config = require('../config');

module.exports = function setupStats(bot, logger) {
    const ADMIN_IDS = config.ADMIN_IDS.split(',').map(id => parseInt(id));

    const ADMIN_COUNT = ADMIN_IDS.length;

    const isAdmin = async (ctx, next) => {
        if (!ADMIN_IDS.includes(ctx.from.id)) {
            return ctx.reply('Admin Command ❌');
        }
        return next();
    };

    const formatISTTime = (date) => {
        return date.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
    };

    bot.command('stats', isAdmin, async (ctx) => {
        try {
            const now = new Date();
            const todayStart = new Date(now);
            todayStart.setHours(0, 0, 0, 0);

            const [
                totalUsers,
                newUsersToday,
                totalFiles,
                filesToday
            ] = await Promise.all([
                User.countDocuments({}),
                User.countDocuments({ created_at: { $gte: todayStart } }),
                File.countDocuments({}),
                File.countDocuments({ timestamp: { $gte: todayStart } })
            ]);

            const formatUptime = (seconds) => {
                const days = Math.floor(seconds / (3600 * 24));
                seconds %= 3600 * 24;
                const hours = Math.floor(seconds / 3600);
                seconds %= 3600;
                const minutes = Math.floor(seconds / 60);
                seconds = Math.floor(seconds % 60);
                return `${days}d ${hours}h ${minutes}m ${seconds}s`;
            };

            const statsMessage = `*Bot Statistics Report*\n
_👥 User Stats:_
• Total Users: ${totalUsers}
• New Users Today: ${newUsersToday}

_⚙️ System Info:_
• Uptime: ${formatUptime(process.uptime())}
• Platform: ${os.platform()} ${os.release()}

_Memory Usage:_ ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB

`;


            await ctx.replyWithMarkdown(statsMessage);

            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'Stats command',
                'SUCCESS',
                'Advanced stats displayed'
            );
        } catch (error) {
            await logger.error(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'Stats command',
                'FAILED',
                error.message
            );
            await ctx.reply('❌ Failed to fetch statistics.');
        }
    });
};