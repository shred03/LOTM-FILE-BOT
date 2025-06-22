const {Markup} = require("telegraf");

const mainKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🏠 Home', 'home'),
        Markup.button.callback('📌Join Channels', 'join_channels')],
    [    Markup.button.callback('ℹ️ About', 'about')]
]);

module.exports = mainKeyboard;