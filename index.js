const express = require('express')
const app = express()
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;

    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' });
    }
    // bearer token
    const token = authorization.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
        if (error) {
            return res.status(401).send({ error: true, message: 'unauthorized access' })
        }

        req.decoded = decoded;
        next();
    })
}

// MongoDB connection 
const uri = process.env.DB_CONNECT

// Create a MongoClient with
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
})

const storage = multer.diskStorage({});
const imageUpload = multer({ storage });
// Cloudinary configuration
cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        const database = client.db('gadget_galaxy')
        const usersCollection = database.collection('users');
        const productCollection = database.collection('products');
        const cartsCollection = database.collection('carts');
        const wishlistCollection = database.collection('wishlist');
        const categoryCollection = database.collection('category');

        // jwt
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '30d' })

            res.send({ token })
        })

        // image upload
        app.post('/upload-images', imageUpload.array('images', 20), async (req, res) => {
            try {
                const uploadedImages = [];

                // Upload each image to Cloudinary
                for (const file of req.files) {
                    const result = await cloudinary.uploader.upload(file.path, {
                        transformation: [
                            { width: 'auto' },
                            { quality: 'auto' },
                            { fetch_format: "avif" }
                        ]
                    });
                    uploadedImages.push(result.secure_url);
                }
                res.json({ images: uploadedImages });
            } catch (error) {
                console.error('Error uploading images:', error);
                res.status(500).json({ error: 'Error uploading images' });
            }
        });

        // ======================= users =======================
        // get all user
        app.get('/users', verifyJWT, async (req, res) => {
            const result = await usersCollection.find().sort({ createdAt: -1 }).toArray();
            res.send(result)
        })

        // get single user
        app.get('/users/:email', async (req, res) => {
            const email = req.params.email;

            const result = await usersCollection.findOne({ email });
            if (result === null) {
                return res.send({ status: 404 })
            }
            res.send(result)
        })

        // post users
        app.post('/users', async (req, res) => {
            const { name, email, role, status, createdBy } = req.body;
            const newUser = { name, email, role, status, createdBy, createdAt: new Date(), updatedAt: new Date() }

            const isExist = await usersCollection.findOne({ email });

            if (isExist) {
                return res.send({ message: 'user already exists' })
            }
            const result = await usersCollection.insertOne(newUser);
            res.send(result)
        })

        // update user info
        app.patch('/users/role/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const { role } = req.body;
            const updateDoc = {
                $set: {
                    role: role,
                    updatedAt: new Date()
                }
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result)
        });

        // update user status
        app.patch('/users/status/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const { status } = req.body;
            const updateDoc = {
                $set: {
                    status: status,
                    updatedAt: new Date()
                }
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result)
        });

        // delete user info
        app.delete('/users/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await usersCollection.deleteOne(query);
            res.send(result)
        });

        // ======================= category =======================
        // get category
        app.get('/category', async (req, res) => {
            const result = await categoryCollection.find().sort({ createdAt: -1 }).toArray();
            res.send(result)
        })

        // ======================= products =======================

        // get products
        app.get('/products', async (req, res) => {
            const result = await productCollection.find().sort({ createdAt: -1 }).toArray();
            res.send(result)
        })

        // get single product
        app.get('/products/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await productCollection.findOne(query);
            res.send(result)
        })

        // get filter product
        app.get('/all-product', async (req, res) => {
            try {
                const { email, search, type, category, brand, sort, page, size } = req.query;

                // Initialize query object
                let query = {};

                // Filter by seller email if provided
                if (email) {
                    query.sellerEmail = email;
                }

                // Search filter by title, category, or type
                if (search) {
                    query.$or = [
                        { title: { $regex: search, $options: 'i' } },
                        { category: { $regex: search, $options: 'i' } },
                        { type: { $regex: search, $options: 'i' } },
                    ];
                }

                // Filter by type
                if (type) {
                    query.type = type;
                }

                // Filter by category
                if (category) {
                    query.category = category;
                }

                // Filter by brand
                if (brand) {
                    query.brand = brand;
                }

                // Pagination
                const currentPage = parseInt(page, 10) || 1;
                const pageSize = parseInt(size, 10) || 12;
                const skip = (currentPage - 1) * pageSize;

                // Sorting
                let sortQuery = { createdAt: -1 };
                if (sort === 'asc') {
                    sortQuery = { sellingPrice: 1 };
                } else if (sort === 'desc') {
                    sortQuery = { sellingPrice: -1 };
                }

                // Get total document count for pagination
                const count = await productCollection.countDocuments(query);

                // Fetch products with filters, sorting, and pagination
                const products = await productCollection
                    .find(query)
                    .sort(sortQuery)
                    .skip(skip)
                    .limit(pageSize)
                    .toArray();

                const categories = [...new Set(products.map(product => product.category))];
                const brands = [...new Set(products.map(product => product.brand))];

                res.json({ count, page: currentPage, size: pageSize, products, categories, brands });
            } catch (error) {
                console.error('Error fetching products:', error);
                res.status(500).json({ message: 'Server Error' });
            }
        });


        // post products
        app.post('/products', verifyJWT, async (req, res) => {
            const newProduct = req.body;
            const result = await productCollection.insertOne({ ...newProduct, createdAt: new Date(), updatedAt: new Date() });
            res.send(result)
        })

        // update product
        app.patch('/products/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = { $set: req.body };
            const result = await productCollection.updateOne(filter, updateDoc);
            res.json(result);
        });

        // delete product
        app.delete('/products/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const deleteCart = await cartsCollection.deleteMany({ productId: id })
            const result = await productCollection.deleteOne(query);
            res.send(result)
        })

        // ======================= cart =======================

        // get carts
        app.get('/carts/:email', async (req, res) => {
            const email = req.params.email;
            const result = await cartsCollection.find({ email }).sort({ createdAt: -1 }).toArray();
            res.send(result)
        })

        // post carts
        app.post('/carts', verifyJWT, async (req, res) => {
            const newProduct = req.body;
            const result = await cartsCollection.insertOne({ ...newProduct, createdAt: new Date() });
            res.send(result)
        })

        // patch carts
        app.patch('/carts/:id', verifyJWT, async (req, res) => {
            const id = req.params.id
            const filter = { _id: new ObjectId(id) }
            const { quantity } = req.body;
            const updateDoc = {
                $set: {
                    quantity: quantity,
                }
            };
            const result = await cartsCollection.updateOne(filter, updateDoc);
            res.send(result)
        })

        // delete carts
        app.delete('/carts/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartsCollection.deleteOne(query);
            res.send(result)
        })

        // ======================= wishlist =======================

        // get wishlist
        app.get('/wishlist/:email', async (req, res) => {
            const email = req.params.email;
            const result = await wishlistCollection.find({ email }).sort({ createdAt: -1 }).toArray();
            res.send(result)
        })

        // post wishlist
        app.post('/wishlist', verifyJWT, async (req, res) => {
            const newProduct = req.body;
            const result = await wishlistCollection.insertOne({ ...newProduct, createdAt: new Date() });
            res.send(result)
        })

        // delete wishlist
        app.delete('/wishlist/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await wishlistCollection.deleteOne(query);
            res.send(result)
        })

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");

    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Gadget Galaxy is running')
})

app.listen(port, () => {
    console.log(`Gadget Galaxy is running ${port}`);
});