import Bot from '../bot'

const server = (app) => {
  app.get('/deposits', (req, res) => {
    res.json([])
  })
}

const bot = new Bot()
bot.run()
setInterval(() => {
  bot.run()
}, 60 * 60 * 100)

export default server
