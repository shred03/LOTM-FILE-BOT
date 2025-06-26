const axios = require('axios');
const { Markup } = require('telegraf');
const Logger = require('../logs/Logs');
const Post = require('../models/Post');
const config = require('../config');

const TMDB_BASE_URL = config.TMDB_BASE_URL;
const TMDB_API_KEY = config.TMDB_API_KEY;

const setupTVPostCommand = (bot, logger, ADMIN_IDS) => {
    const isAdmin = async (ctx, next) => {
        if (!ADMIN_IDS.includes(ctx.from.id)) {
            return ctx.reply('Admin Command ❌');
        }
        return next();
    };

    const searchTVSeries = async (seriesName, page = 1) => {
        try {
            const searchResponse = await axios.get(`${TMDB_BASE_URL}/search/tv`, {
                params: {
                    api_key: TMDB_API_KEY,
                    query: seriesName,
                    include_adult: false,
                    language: 'en-US',
                    page: page
                }
            });

            return searchResponse.data;
        } catch (error) {
            console.error('Error searching TV series:', error);
            return null;
        }
    };

    const getTVSeriesDetails = async (seriesId) => {
        try {
            const seriesResponse = await axios.get(`${TMDB_BASE_URL}/tv/${seriesId}`, {
                params: {
                    api_key: TMDB_API_KEY,
                    language: 'en-US'
                }
            });

            return seriesResponse.data;
        } catch (error) {
            console.error('Error fetching TV series details:', error);
            return null;
        }
    };

    const formatGenres = (genres) => {
        return genres.map(genre => genre.name).join(', ');
    };

    const createTVSeriesPost = (seriesData, seasonLinks) => {
        const firstAirYear = seriesData.first_air_date ? 
            new Date(seriesData.first_air_date).getFullYear() : 'N/A';
            
        const genres = formatGenres(seriesData.genres);
        const numberOfSeasons = seriesData.number_of_seasons || "NA";
        const episodeRuntime = seriesData.episode_run_time && seriesData.episode_run_time.length > 0 ? 
            seriesData.episode_run_time[0] : "NA";
        const episodeCounts = seriesData.seasons.map(season => season.episode_count).join("/");
        
        function formatRuntime(minutes) {
            if (!minutes || isNaN(minutes)) return "NA";
            
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
          
            return hours > 0 
              ? `${hours} hr ${remainingMinutes} min`
              : `${remainingMinutes} min`;
        }
        const formattedRuntime = formatRuntime(episodeRuntime);
        
        const caption = `<b>${seriesData.name} (${firstAirYear})</b>
╭──────────────────────
» 𝗔𝘂𝗱𝗶𝗼: Hindi-English (E-subs)
» 𝗤𝘂𝗮𝗹𝗶𝘁𝘆: 480p | 720p | 1080p 
» 𝗥𝘂𝗻𝘁𝗶𝗺𝗲: ${formattedRuntime}
» 𝗦𝗲𝗮𝘀𝗼𝗻𝘀: ${numberOfSeasons}
» 𝗘𝗽𝗶𝘀𝗼𝗱𝗲𝘀: ${episodeCounts}
├──────────────────────
» 𝗚𝗲𝗻𝗿𝗲𝘀: ${genres}
╰──────────────────────
    
<b>@Teamxpirates</b>
<blockquote>[𝗜𝗳 𝗬𝗼𝘂 𝗦𝗵𝗮𝗿𝗲 𝗢𝘂𝗿 𝗙𝗶𝗹𝗲𝘀 𝗪𝗶𝘁𝗵𝗼𝘂𝘁 𝗖𝗿𝗲𝗱𝗶𝘁, 𝗧𝗵𝗲𝗻 𝗬𝗼𝘂 𝗪𝗶𝗹𝗹 𝗯𝗲 𝗕𝗮𝗻𝗻𝗲𝗱]</blockquote>`;

        const buttons = seasonLinks.map(seasonLink => {
            const [buttonText, link] = seasonLink.trim().split('=').map(item => item.trim());
            return Markup.button.url(buttonText, link);
        });

        const buttonRows = [];
        for (let i = 0; i < buttons.length; i += 2) {
            const row = buttons.slice(i, i + 2);
            buttonRows.push(row);
        }

        const inlineKeyboard = Markup.inlineKeyboard(buttonRows);

        return {
            caption,
            keyboard: inlineKeyboard
        };
    };

    const getTVSeriesImageUrl = (seriesData) => {
        // Use backdrop_path (16:9 ratio) primarily
        if (seriesData.backdrop_path) {
            return `https://image.tmdb.org/t/p/original${seriesData.backdrop_path}`;
        }
        // Fall back to poster_path if backdrop is not available
        else if (seriesData.poster_path) {
            return `https://image.tmdb.org/t/p/w500${seriesData.poster_path}`;
        }
        return null;
    };

    const createPaginationKeyboard = (queryId, currentPage, totalPages) => {
        const buttons = [];
        
        if (currentPage > 1) {
            buttons.push(Markup.button.callback('◀️ Previous', `tvpage_${queryId}_${currentPage - 1}`));
        }
        
        buttons.push(Markup.button.callback(`${currentPage}/${totalPages}`, 'noop'));
        
        if (currentPage < totalPages) {
            buttons.push(Markup.button.callback('Next ▶️', `tvpage_${queryId}_${currentPage + 1}`));
        }
        
        return buttons;
    };

    bot.command(['sp'], isAdmin, async (ctx) => {
        try {
            setTimeout(async () => {
                await ctx.deleteMessage()
            }, 5000);

            const commandText = ctx.message.text.substring(8).trim(); 
            
            if (!commandText.includes('|')) {
                await logger.command(
                    ctx.from.id,
                    `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                    'TV Post command used',
                    'FAILED',
                    'Invalid format'
                );
                return ctx.reply('Please use the format: /tvpost Series_Name | Season 1 = link1 | Season 2 = link2 | ...');
            }

            const parts = commandText.split('|').map(part => part.trim());
            const seriesName = parts[0];
            const seasonLinks = parts.slice(1);
            
            if (seasonLinks.length === 0) {
                await logger.command(
                    ctx.from.id,
                    `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                    'TV Post command used',
                    'FAILED',
                    'No season links provided'
                );
                return ctx.reply('Please provide at least one season link in the format: Season X = link');
            }

            // Validate season links format
            for (const seasonLink of seasonLinks) {
                if (!seasonLink.includes('=')) {
                    return ctx.reply(`Invalid format for '${seasonLink}'. Please use 'Season X = link' format.`);
                }
            }

            const postSetting = await Post.getLatestForAdmin(ctx.from.id);
            
            if (!postSetting) {
                await logger.command(
                    ctx.from.id,
                    `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                    'TV Post command used',
                    'FAILED',
                    'No channel set'
                );
                return ctx.reply('❌ No channel set. Please use /setchannel command first.');
            }

            const processingMsg = await ctx.reply('⌛ Searching for TV series...');
            const searchResults = await searchTVSeries(seriesName);

            if (!searchResults || !searchResults.results || searchResults.results.length === 0) {
                await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
                await logger.command(
                    ctx.from.id,
                    `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                    'TV Post command used',
                    'FAILED',
                    `No TV series found for: ${seriesName}`
                );
                return ctx.reply(`❌ No TV series found for: "${seriesName}"`);
            }

            bot.context.tvSearchCache = bot.context.tvSearchCache || {};
            const queryId = `tvq${ctx.from.id}_${Date.now()}`;
            
            bot.context.tvSearchCache[queryId] = {
                query: seriesName,
                seasonLinks,
                currentPage: 1,
                totalPages: searchResults.total_pages,
                results: searchResults
            };

            const seriesButtons = searchResults.results.map(series => {
                const year = series.first_air_date ? new Date(series.first_air_date).getFullYear() : 'N/A';
                return [Markup.button.callback(
                    `${series.name} (${year})`,
                    `tvseries_${series.id}_${queryId}`
                )];
            });

            if (searchResults.total_pages > 1) {
                seriesButtons.push(
                    createPaginationKeyboard(queryId, 1, searchResults.total_pages)
                );
            }

            await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);

            await ctx.reply(
                `📺 Found ${searchResults.total_results} results for "${seriesName}"\n\nPlease select a TV series:`,
                Markup.inlineKeyboard(seriesButtons)
            );

            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'TV Post command used',
                'SUCCESS',
                `Searched for TV series: ${seriesName}, found ${searchResults.total_results} results`
            );
            
        } catch (error) {
            console.error('Error in TV post command:', error);
            await logger.error(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'TV Post command used',
                'FAILED',
                error.message
            );
            await ctx.reply('Error searching for TV series. Please try again.');
        }
    });

    bot.action(/^tvpage_(.+)_(\d+)$/, async (ctx) => {
        try {
            const queryId = ctx.match[1];
            const page = parseInt(ctx.match[2]);
            
            if (!bot.context.tvSearchCache || !bot.context.tvSearchCache[queryId]) {
                return ctx.answerCbQuery('Session expired. Please search again.');
            }
            
            const cachedSearch = bot.context.tvSearchCache[queryId];
            const searchResults = await searchTVSeries(cachedSearch.query, page);
            
            if (!searchResults || !searchResults.results || searchResults.results.length === 0) {
                await ctx.answerCbQuery('No results found on this page');
                return;
            }

            cachedSearch.currentPage = page;
            cachedSearch.results = searchResults;

            const seriesButtons = searchResults.results.map(series => {
                const year = series.first_air_date ? new Date(series.first_air_date).getFullYear() : 'N/A';
                return [Markup.button.callback(
                    `${series.name} (${year})`,
                    `tvseries_${series.id}_${queryId}`
                )];
            });

            seriesButtons.push(
                createPaginationKeyboard(queryId, page, searchResults.total_pages)
            );

            await ctx.editMessageText(
                `📺 Found ${searchResults.total_results} results for "${cachedSearch.query}" (Page ${page}/${searchResults.total_pages})\n\nPlease select a TV series:`,
                Markup.inlineKeyboard(seriesButtons)
            );
            
            await ctx.answerCbQuery();
        } catch (error) {
            console.error('Error handling TV pagination:', error);
            await ctx.answerCbQuery('Error loading page');
        }
    });

    bot.action(/^tvseries_(\d+)_(.+)$/, async (ctx) => {
        try {
            const seriesId = ctx.match[1];
            const queryId = ctx.match[2];

            if (!bot.context.tvSearchCache || !bot.context.tvSearchCache[queryId]) {
                return ctx.answerCbQuery('Session expired. Please search again.');
            }
            
            const cachedSearch = bot.context.tvSearchCache[queryId];
            const seasonLinks = cachedSearch.seasonLinks;

            await ctx.answerCbQuery('Loading TV series details...');
            await ctx.editMessageText('⌛ Fetching TV series details...');

            const seriesData = await getTVSeriesDetails(seriesId);
            
            if (!seriesData) {
                return ctx.editMessageText('❌ Error fetching TV series details. Please try again.');
            }

            const post = createTVSeriesPost(seriesData, seasonLinks);
            const imageUrl = getTVSeriesImageUrl(seriesData);
            const postSetting = await Post.getLatestForAdmin(ctx.from.id);
            
            const channelInfo = postSetting.channelUsername ? 
                `@${postSetting.channelUsername}` : 
                postSetting.channelId;
            
            const postId = `tvp${ctx.from.id}_${Date.now()}`;
            
            const confirmationButtons = Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ Post to Channel', `tvconfirm_${postId}`),
                    Markup.button.callback('❌ Cancel', `tvcancel_${postId}`)
                ]
            ]);

            bot.context.tvPostData = bot.context.tvPostData || {};
            bot.context.tvPostData[postId] = {
                seriesData,
                seasonLinks,
                imageUrl,
                post,
                channelId: postSetting.channelId,
                channelInfo
            };
            
            if (imageUrl) {
                await ctx.telegram.sendPhoto(ctx.chat.id, imageUrl, {
                    caption: `<b>Preview:</b>\n\n${post.caption}\n\n<i>Ready to post to ${channelInfo}</i>`,
                    parse_mode: 'HTML',
                    ...post.keyboard
                });
            } else {
                await ctx.telegram.sendMessage(ctx.chat.id, `<b>Preview:</b>\n\n${post.caption}\n\n<i>Ready to post to ${channelInfo}</i>`, {
                    parse_mode: 'HTML',
                    ...post.keyboard
                });
            }
            
            await ctx.telegram.sendMessage(ctx.chat.id, 'Would you like to post this to your channel?', confirmationButtons);
            
            if (bot.context.tvSearchCache && bot.context.tvSearchCache[queryId]) {
                delete bot.context.tvSearchCache[queryId];
            }
            
            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'TV Series selected',
                'SUCCESS',
                `Created post preview for TV series: ${seriesData.name}`
            );
            
        } catch (error) {
            console.error('Error selecting TV series:', error);
            await ctx.answerCbQuery('Error loading TV series');
            await ctx.editMessageText('Error creating TV series post. Please try again.');
            
            await logger.error(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'TV Series selection',
                'FAILED',
                error.message
            );
        }
    });
    
    bot.action(/^tvconfirm_(.+)$/, async (ctx) => {
        try {
            setTimeout(async () => {
                await ctx.deleteMessage()
            }, 10000)

            const postId = ctx.match[1];
            
            if (!bot.context.tvPostData || !bot.context.tvPostData[postId]) {
                await ctx.answerCbQuery('❌ Post data not found');
                return ctx.editMessageText('Unable to find post data. Please create a new post.');
            }
            
            const postData = bot.context.tvPostData[postId];
            const postSetting = await Post.getLatestForAdmin(ctx.from.id);
            
            let sentMessage;
            if (postData.imageUrl) {
                sentMessage = await ctx.telegram.sendPhoto(postData.channelId, postData.imageUrl, {
                    caption: postData.post.caption,
                    parse_mode: 'HTML',
                    ...postData.post.keyboard
                });
            } else {
                sentMessage = await ctx.telegram.sendMessage(postData.channelId, postData.post.caption, {
                    parse_mode: 'HTML',
                    ...postData.post.keyboard
                });
            }

            if (postSetting && postSetting.stickerId) {
                try {
                    await ctx.telegram.sendSticker(postData.channelId, postSetting.stickerId);
                } catch (stickerError) {
                    console.error('Error sending sticker:', stickerError);
                }
            }

            const postConfimationMsg = '✅ Post sent to channel!'
            await ctx.answerCbQuery(postConfimationMsg);
            const detailedMsg = `✅ Post for "${postData.seriesData.name}" has been sent to ${postData.channelInfo} successfully!`
            await ctx.editMessageText(detailedMsg);
            
            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'TV Series post to channel',
                'SUCCESS',
                `Posted ${postData.seriesData.name} to channel ${postData.channelInfo}`
            );
            
            delete bot.context.tvPostData[postId];
            
        } catch (error) {
            console.error('Error sending TV series post to channel:', error);
            await ctx.answerCbQuery('❌ Error sending post');
            await ctx.editMessageText('Error sending post to channel. Please check bot permissions and try again.');
            
            await logger.error(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'TV Series post to channel',
                'FAILED',
                error.message
            );
        }
    });
    
    bot.action(/^tvcancel_(.+)$/, async (ctx) => {
        try {
            setTimeout(async () => {
                await ctx.deleteMessage()
            }, 10000)

            const postId = ctx.match[1];
            
            if (bot.context.tvPostData && bot.context.tvPostData[postId]) {
                delete bot.context.tvPostData[postId];
            }
            
            await ctx.answerCbQuery('Post cancelled');
            await ctx.editMessageText('❌ Post cancelled.');
            
        } catch (error) {
            console.error('Error cancelling TV series post:', error);
            await ctx.answerCbQuery('Error cancelling post');
            await ctx.editMessageText('Error occurred while cancelling post.');
        }
    });
};

module.exports = setupTVPostCommand;