const server = (app) => {
  app.get('/foo', (req, res) => {
    res.json({ hello: 'world' })
  })
}

export default server
