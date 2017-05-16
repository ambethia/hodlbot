import Bot from '../bot'

const server = (app) => {
  app.get('/deposits', (req, res) => {
    res.json([])
  })
}

const bot = new Bot()
setInterval(() => {
  bot.run()
}, 60 * 60 * 100)

export default server
