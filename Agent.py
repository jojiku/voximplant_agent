import os
from langchain_classic.chains import ConversationalRetrievalChain
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_community.document_loaders import TextLoader
from langchain_community.vectorstores import Chroma
from langchain_classic.text_splitter import CharacterTextSplitter
from langchain_classic.prompts import PromptTemplate

# Шаблон для промпта
template = """
Ты — русскоязычный ассистент службы поддержки мобильного оператора 'Vector'.
Твоя задача — вежливо и по делу отвечать на вопросы клиентов, используя только информацию из предоставленной базы знаний.
Не придумывай ничего от себя. Если в базе знаний нет ответа на вопрос, вежливо сообщи, что у тебя нет такой информации и ты не можешь помочь.
Не проси пользователя предоставить дополнительную информацию. Просто отвечай на основе того, что есть.

Контекст из базы знаний:
{context}

Вопрос клиента:
{question}

Ответ:
"""

class Agent:
    def __init__(self) -> None:
        """
        Инициализация агента: загрузка документов, создание векторной базы,
        инициализация языковой модели и цепочки для ответов.
        """
        # 1. Загрузка и разделение документа
        loader = TextLoader('gaz.txt', encoding='utf-8')
        documents = loader.load()
        text_splitter = CharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
        docs = text_splitter.split_documents(documents)

        # 2. Создание векторной базы данных с использованием OpenAI
        embeddings = OpenAIEmbeddings(
            base_url="http://127.0.0.1:1234/v1",
            api_key="lm-studio",
            model="text-embedding-multilingual-e5-large-instruct",
            check_embedding_ctx_length=False
        )
        self.vectorstore = Chroma.from_documents(docs, embeddings)

        # 3. Инициализация языковой модели с поддержкой стриминга
        self.llm = ChatOpenAI(
        base_url="http://127.0.0.1:1234/v1",
        api_key="lm-studio",  
        model="lfm2-1.2b",
        temperature=0.7,
        streaming=True
        )

        # 4. Создание цепочки с кастомным промптом
        prompt = PromptTemplate(template=template, input_variables=["context", "question"])
        
        # Создаем ретривер для поиска по базе знаний
        retriever = self.vectorstore.as_retriever(search_kwargs={"k": 2})

        self.qa_chain = ConversationalRetrievalChain.from_llm(
            llm=self.llm,
            retriever=retriever,
            combine_docs_chain_kwargs={'prompt': prompt},
            return_source_documents=False,
        )
        self.chat_history = []

    def get_response_generator(self, user_question: str):
        """
        Получает вопрос пользователя, обращается к цепочке и возвращает
        генератор для потоковой передачи ответа.
        """
        full_response = ""
        # Используем .stream() для получения потокового ответа
        response_generator = self.qa_chain.stream({
            "question": user_question, 
            "chat_history": self.chat_history
        })

        for chunk in response_generator:
            # Langchain stream() для этой цепочки возвращает словарь, 
            # где ответ находится в ключе 'answer'
            if "answer" in chunk:
                response_part = chunk['answer']
                yield response_part
                full_response += response_part
        
        # Обновляем историю диалога после получения полного ответа
        self.chat_history.append((user_question, full_response))
