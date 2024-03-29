'use strict'
const express = require('express');
const Discord = require('discord.js');
const fetch = require('node-fetch');
const Mongo = require('mongodb');
const crypto = require('crypto');
const hash = function (value) { return crypto.createHash('sha512').update(value).digest('hex'); }
const app = express();
const client = new Discord.Client({
    intents: [Discord.Intents.FLAGS.GUILDS, Discord.Intents.FLAGS.DIRECT_MESSAGES, Discord.Intents.FLAGS.GUILD_MEMBERS]
});

client.on('ready', async function () {
    const data = [{
        name: 'twofa',
        description: 'Set up two-factor authentication',
        options: [{
            type: 'ROLE',
            name: 'verifiedrole',
            description: 'Roles given to authenticated members. If you specify @everyone, disable authentication',
            required: true
        }, {
            type: 'BOOLEAN',
            name: 'canuseoldauthdata',
            description: '(Default: true) Whether or not data that has been authenticated in the past can be used',
            required: false
        }]
    }, {
        name: 'setbtn',
        description: 'Send the Start Authentication button to the channel you ran',
        options: [{
            type: 'STRING',
            name: 'msg',
            description: 'Text in the message',
            required: false
        }, {
            type: 'STRING',
            name: 'btn',
            description: 'Text in the button',
            required: false
        }]
    }]
    await client.application.commands.set(data);
    console.log('client is ready');
});
client.on('interactionCreate', async function (interaction) {
    if (interaction.isCommand()) {
        if (interaction.commandName === 'twofa') {
            if (!interaction.member.permissions.has(Discord.Permissions.FLAGS.ADMINISTRATOR)) {
                interaction.reply({ content: 'Administrator rights are required to run this command', ephemeral: true });
                return
            }
            if (interaction.options.getRole('verifiedrole').comparePositionTo(interaction.member.guild.me.roles.botRole) >= 0) {
                interaction.reply('Because the bot is below the target role, Unable to set');
                return
            }
            let oldauthdata = interaction.options.getBoolean('canuseoldauthdata');
            if (!oldauthdata) {
                oldauthdata = true
            }
            const dbclient = new Mongo.MongoClient(`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fkhxd.mongodb.net/2auth?retryWrites=true&w=majority`);
            const mongoclient = await dbclient.connect();
            const setting = mongoclient.db('2auth').collection('setting');
            if (interaction.options.getRole('verifiedrole').id == interaction.guild.roles.everyone.id) {
                await setting.findOneAndDelete({ guild: interaction.guild.id });
                dbclient.close();
            } else {
                const hit = await setting.findOne({ guild: interaction.guild.id });
                if (hit) {
                    await setting.findOneAndReplace({ guild: interaction.guild.id }, { guild: interaction.guild.id, canold: oldauthdata, role: interaction.options.getRole('verifiedrole').id });
                    dbclient.close();
                } else {
                    await setting.insertOne({ guild: interaction.guild.id, canold: oldauthdata, role: interaction.options.getRole('verifiedrole').id });
                    dbclient.close();
                }
            }
            interaction.reply({ content: 'Updated settings\nSend the start authentication button using /setbtn', ephemeral: true });
        }
        if (interaction.commandName == 'setbtn') {
            if (interaction.member.permissions.has(Discord.Permissions.FLAGS.MANAGE_CHANNELS), false) {
                interaction.reply({ content: 'you do not have the necessary permissions', ephemeral: true });
            }
            let msg = interaction.options.getString('msg');
            if (!msg) {
                msg = 'Allow dm, then click the button below'
            }
            let btn = interaction.options.getString('btn');
            if (!btn) {
                btn = ' Start authentication (use dm)'
            }
            const comp = new Discord.MessageActionRow()
                .addComponents(
                    new Discord.MessageButton()
                        .setCustomId('startauth')
                        .setLabel(btn)
                        .setStyle('PRIMARY')
                        .setEmoji('🔓')
                );
            interaction.reply({ content: msg, components: [comp] });
        }
    }
    if (interaction.isButton()) {
        if (interaction.component.customId == 'startauth') {
            const member = interaction.member
            if (!member.user.bot) {
                const dbclient = new Mongo.MongoClient(`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fkhxd.mongodb.net/2auth?retryWrites=true&w=majority`);
                const mongoclient = await dbclient.connect();
                const setting = mongoclient.db('2auth').collection('setting');
                const authing = mongoclient.db('2auth').collection('authing');
                const authed = mongoclient.db('2auth').collection('authed');
                const hitmember = await authing.findOne({ id: member.id });
                if (hitmember) {
                    interaction.reply({ content: 'Currently authenticating. Press the button again after authentication is complete', ephemeral: true });
                } else {
                    let authend = false;
                    const hitsetting = await setting.findOne({ guild: member.guild.id });
                    if (hitsetting) {
                        const id = await authed.findOne({ id: hash(member.id) });
                        if (hitsetting.canold && id) {
                            member.roles.add(hitsetting.role);
                            authend = true
                        }
                        if (!authend) {
                            const dm = await member.createDM();
                            let code = Math.floor(Math.random() * 1000000);
                            while (String(code).length != 6) {
                                code = Math.floor(Math.random() * 1000000);
                            }
                            await authing.insertOne({ id: member.id, guild: member.guild.id, code: code });
                            let cancel = false
                            try {
                                await member.createDM();
                                dm.send('https://twofactorauthenticationservice.herokuapp.com/?start=0 Open. After that, please complete the authentication by entering the code below');
                                await dm.send(String(code));
                                dm.messages.pin(vaule);
                            } catch (error) {
                                interaction.reply({ content: 'dm could not be sent. Check your privacy settings', ephemeral: true });
                                authing.findOneAndDelete({ id: member.id, guild: member.guild.id, code: code });
                                cancel = true
                            }
                            if (cancel) {
                                dbclient.close();
                                interaction.reply({ content: 'Authentication message sent to dm', ephemeral: true });
                            }
                        }
                    } else {
                        interaction.reply({ content: 'Two-factor authentication is not valid on this server', ephemeral: true })
                    }
                }
            }
        }
    }
});
client.login();
app.get('/', async function (request, response) {
    if (request.query.code) {
        const res = await fetch('https://discordapp.com/api/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `client_id=${process.env.CLIENT_ID}&client_secret=${process.env.CLIENT_SECRET}&grant_type=authorization_code&code=${request.query.code}&redirect_uri=https://twofactorauthenticationservice.herokuapp.com/`
        });
        const json = await res.json();
        const access_token = json.access_token
        const idres = await fetch('https://discordapp.com/api/users/@me', {
            headers: {
                'Authorization': `Bearer ${access_token}`
            }
        });
        const idjson = await idres.json();
        const dbclient = new Mongo.MongoClient(`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fkhxd.mongodb.net/2auth?retryWrites=true&w=majority`);
        const mongoclient = await dbclient.connect();
        const authing = mongoclient.db('2auth').collection('authing');
        const hit = await authing.findOne({ id: idjson.id });
        if (hit) {
            return response.redirect(`/?id=${idjson.id}`);
        } else {
            response.send('You are not currently authenticated');
        }
    } else if (request.query.number && request.query.id && request.query.savehash) {
        const dbclient = new Mongo.MongoClient(`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fkhxd.mongodb.net/2auth?retryWrites=true&w=majority`);
        const mongoclient = await dbclient.connect();
        const setting = mongoclient.db('2auth').collection('setting');
        const authing = mongoclient.db('2auth').collection('authing');
        const authed = mongoclient.db('2auth').collection('authed');
        const hit = await authing.findOne({ id: request.query.id });
        if (hit) {
            if (hit.code == request.query.number) {
                response.send('<h1>Authentication successful! <a href="#" onclick="window.close();return false">You can close this window</a></h1>');
                const hitsetting = await setting.findOne({ guild: hit.guild });
                const hitauthed = await authed.findOne({ id: hash(request.query.id) });
                if (hitsetting.canold && request.query.savehash == 'on' && !hitauthed) {
                    authed.insertOne({ id: hash(request.query.id) });
                }
                const guildserver = await client.guilds.fetch(hit.guild);
                const member = await guildserver.members.fetch(request.query.id);
                await member.roles.add(hitsetting.role);
                await authing.findOneAndDelete({ id: request.query.id });
                dbclient.close();
            } else {
                response.send('Authentication failed. <a href="/?start=0">Try again</a>');
            }
        }
    } else if (request.query.redir) {
        if (request.query.redir.startsWith('https://discord.gg') | request.query.redir.startsWith('https://discord.com')) {
            response.redirect(request.query.redir);
        } else {
            response.send('To redirect, specify an invitation link to discord that starts with https://discord.gg/ or https://discord.com.');
        }
    } else {
        return response.sendFile('index.html', { root: '.' });
    }
});
app.get('/auth', function (req, res) {
    res.redirect('https://discord.com/api/oauth2/authorize?client_id=947435878891008041&redirect_uri=https%3A%2F%2Ftwofactorauthenticationservice.herokuapp.com%2F&response_type=code&scope=identify');
});
app.get('/bot', function (req, res) {
    res.redirect('https://discord.com/api/oauth2/authorize?client_id=947435878891008041&permissions=268437504&scope=bot%20applications.commands');
});
app.listen(process.env.PORT, function () {
    console.log('HTTP server is listening');
});